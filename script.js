import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ReflectorWithDistortion } from './ReflectorWithDistortion.js';
import { openCatalog } from './catalog.js';

const modelConfig = [
    { 
        name: 'Kowal', 
        file: 'models/kowal.glb', 
        panelImage: 'images/panel_kowal.webp', 
        animation: { fps: 30, idleFrame: 10, activeStartFrame: 11, activeEndFrame: 45 },
    },
    { name: 'Krawiec', file: 'models/krawiec.glb', panelImage: 'images/panel_krawiec.webp', animation: { fps: 30, idleFrame: 0 } },
    { name: 'Alchemik', file: 'models/alchemik.glb', panelImage: 'images/panel_kowal.webp', animation: { fps: 30, idleFrame: 0 } },
];

let scene, camera, renderer, composer;
let sceneContainerGroup, introAnimationGroup;
let kowale = [], mixers = [], panelLights = [];
let clock = new THREE.Clock(), raycaster = new THREE.Raycaster(), mouse = new THREE.Vector2();
let currentlyHovered = null, selectedCharacter = null, spotlight;
let logoMesh, groundMesh; 

let cameraTransition = {
    active: false, startTime: 0, duration: 1.5,
    startPos: new THREE.Vector3(), endPos: new THREE.Vector3(),
    startLookAt: new THREE.Vector3(), endLookAt: new THREE.Vector3(),
};

let appState = 'intro_logo'; 
const infoElement = document.getElementById('info');

let introAnimation = { revealStartTime: 0, revealDuration: 2.0, finished: false, animatedPanels: [] };
const ARC_RADIUS = 28; const ARC_ANGLE = 1.4; const ARC_BASE_DEPTH = -8;
modelConfig.forEach((config, i) => { const fraction = modelConfig.length > 1 ? i / (modelConfig.length - 1) : 0.5; const angle = (fraction - 0.5) * ARC_ANGLE; config.position = new THREE.Vector3( ARC_RADIUS * Math.sin(angle), 1, ARC_BASE_DEPTH + (ARC_RADIUS * (1 - Math.cos(angle))) ); config.rotationY = -angle; });

init();

function frameToTime(frame, fps) { return frame / fps; }

async function init() {
    try {
        const dataPromises = modelConfig.map(config => {
            const fileName = config.name.toLowerCase();
            return fetch(`data/${fileName}.json`)
                .then(response => {
                    if (!response.ok) {
                        console.warn(`Could not find data file: data/${fileName}.json. Using empty item list.`);
                        return { items: [] };
                    }
                    return response.json();
                })
                .catch(error => {
                    console.error(`Error loading or parsing data/${fileName}.json:`, error);
                    return { items: [] };
                });
        });
        const charactersData = await Promise.all(dataPromises);
        modelConfig.forEach((config, index) => {
            config.items = charactersData[index].items;
        });
    } catch (error) {
        console.error("A critical error occurred during data loading:", error);
        modelConfig.forEach(config => config.items = []);
    }

    const container = document.getElementById('scene-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.Fog(0x000000, 25, 55);
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 6, 25);
    camera.lookAt(0, 3, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);
    sceneContainerGroup = new THREE.Group(); scene.add(sceneContainerGroup);
    introAnimationGroup = new THREE.Group(); scene.add(introAnimationGroup);
    const groundGeo = new THREE.PlaneGeometry(100, 100);
    groundMesh = new ReflectorWithDistortion(groundGeo, { clipBias: 0.003, textureWidth: window.innerWidth * window.devicePixelRatio, textureHeight: window.innerHeight * window.devicePixelRatio, color: 0x050505, });
    groundMesh.rotation.x = -Math.PI / 2; groundMesh.position.y = -0.01; sceneContainerGroup.add(groundMesh);
    spotlight = new THREE.SpotLight(0xffffff, 200, 50);
    spotlight.angle = Math.PI / 15; spotlight.penumbra = 0.6; spotlight.decay = 2; spotlight.castShadow = true; spotlight.visible = false; scene.add(spotlight);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.05; bloomPass.strength = 0.4;  bloomPass.radius = 0.3;
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(bloomPass);
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('SaganTeam.png', (texture) => { const logoGeo = new THREE.PlaneGeometry(35, 35); const logoMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 1.5 }); logoMesh = new THREE.Mesh(logoGeo, logoMat); logoMesh.position.set(0, 10, -30); scene.add(logoMesh); });
    textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/waternormals.jpg', function (normalMap) { normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping; groundMesh.material.uniforms.tNormal.value = normalMap; });
    const originalOnBeforeRender = groundMesh.onBeforeRender;
    groundMesh.onBeforeRender = (renderer, scene, camera) => { if (logoMesh) logoMesh.visible = false; originalOnBeforeRender.call(groundMesh, renderer, scene, camera); if (logoMesh) logoMesh.visible = true; };

    createIntroScene();
    loadMainScene();
    startIntroSequence();
    
    window.addEventListener('resize', onWindowResize);
    document.addEventListener('mousemove', onDocumentMouseMove);
    document.addEventListener('click', onDocumentClick);

    animate(); // Rozpoczęcie pętli animacji po zakończeniu inicjalizacji
}

function onDocumentClick(event) {
    if (appState !== 'main_scene' || !currentlyHovered || cameraTransition.active) return;
    selectedCharacter = currentlyHovered;
    const items = selectedCharacter.userData.config.items;
    if (!items || items.length === 0) {
        console.log(`${selectedCharacter.name} nie ma żadnych przedmiotów do pokazania.`);
        return;
    }
    appState = 'transition_zoom_in';
    cameraTransition.active = true;
    cameraTransition.startTime = clock.getElapsedTime();
    cameraTransition.startPos.copy(camera.position);
    const endPosOffset = new THREE.Vector3(0, 2.5, 6);
    cameraTransition.endPos.copy(selectedCharacter.localToWorld(endPosOffset));
    cameraTransition.startLookAt.set(0, 3, 0);
    const targetPosition = new THREE.Vector3();
    selectedCharacter.getWorldPosition(targetPosition);
    cameraTransition.endLookAt.copy(targetPosition).add(new THREE.Vector3(0, 2, 0));
    infoElement.style.opacity = '0';
    document.body.style.cursor = 'default';
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();
    updateWorld(delta);
    switch (appState) {
        // ZMIANA: Usunięto case 'intro_flicker'
        case 'intro_reveal': animateReveal(elapsedTime); break;
        case 'transition_zoom_in': animateCameraTransition(elapsedTime); break;
        case 'transition_zoom_out': animateCameraTransition(elapsedTime, true); break;
    }
    composer.render();
}

function updateWorld(delta) {
    if (groundMesh && groundMesh.material.uniforms.time) {
        groundMesh.material.uniforms.time.value += delta;
    }
    mixers.forEach(mixer => mixer.update(delta));
    kowale.forEach(model => {
        const { action, config, isLoopingSubclip } = model.userData;
        if (action && isLoopingSubclip) {
            const animConfig = config.animation;
            if (animConfig.activeEndFrame) {
                const startTime = frameToTime(animConfig.activeStartFrame, animConfig.fps);
                const endTime = frameToTime(animConfig.activeEndFrame, animConfig.fps);
                if (action.time >= endTime) {
                    action.time = startTime;
                }
            }
        }
    });
}

function onDocumentMouseMove(event) {
    if (appState !== 'main_scene' || cameraTransition.active) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const objectsToTest = [...kowale, ...introAnimation.animatedPanels];
    const intersects = raycaster.intersectObjects(objectsToTest, true);
    const intersectedModel = intersects.length > 0 ? findModelFromIntersection(intersects[0].object) : null;
    if (intersectedModel && intersectedModel !== currentlyHovered) {
        if (currentlyHovered) {
            resetAnimation(currentlyHovered);
        }
        currentlyHovered = intersectedModel;
        playHoverAnimation(currentlyHovered);
        highlightModel(currentlyHovered);
        document.body.style.cursor = 'pointer';
    } else if (!intersectedModel && currentlyHovered) {
        if (currentlyHovered !== selectedCharacter) {
            resetAnimation(currentlyHovered);
            removeHighlight();
        }
        currentlyHovered = null;
        document.body.style.cursor = 'default';
    }
}

// ZMIANA: Uproszczona sekwencja startowa, pomijająca mruganie.
function startIntroSequence() {
    setTimeout(() => {
        const introOverlay = document.getElementById('intro-overlay');
        introOverlay.style.opacity = '0';
        setTimeout(() => {
            introOverlay.style.display = 'none';
            // Sortujemy panele od środka na zewnątrz
            introAnimation.animatedPanels.sort((a, b) => a.userData.sortValue - b.userData.sortValue);
            // Od razu przechodzimy do animacji zapalania paneli
            appState = 'intro_reveal';
            introAnimation.revealStartTime = clock.getElapsedTime();
        }, 1000); // Czas musi odpowiadać transition w CSS
    }, 2000);
}

function createIntroScene() {
    const panelGeo = new THREE.PlaneGeometry(3.5, 8);
    const textureLoader = new THREE.TextureLoader();
    const fontLoader = new FontLoader();
    fontLoader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', (font) => {
        modelConfig.forEach((config, i) => {
            textureLoader.load(config.panelImage, (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace;
                const panelMat = new THREE.MeshStandardMaterial({
                    color: 0x000000,
                    emissive: 0xffffff,
                    emissiveMap: texture,
                    emissiveIntensity: 0,
                    toneMapped: false,
                    side: THREE.DoubleSide
                });
                const panel = new THREE.Mesh(panelGeo, panelMat);
                panel.position.set(config.position.x, 5, config.position.z - 0.2);
                panel.rotation.y = config.rotationY;
                panel.userData = { finalIntensity: 1.5, sortValue: Math.abs(config.position.x), modelIndex: i };
                introAnimationGroup.add(panel);
                introAnimation.animatedPanels.push(panel);
                const light = new THREE.PointLight(0xffffff, 0, 15);
                light.position.copy(panel.position);
                introAnimationGroup.add(light);
                panelLights.push(light);
            }, undefined, () => console.error(`Nie udało się załadować tekstury panelu: ${config.panelImage}`));
        });
    });
}

function loadMainScene() {
    const loader = new GLTFLoader();
    const hitboxGeo = new THREE.CylinderGeometry(2, 2, 8, 16);
    const hitboxMat = new THREE.MeshBasicMaterial({ visible: false });
    modelConfig.forEach((config, i) => {
        loader.load(config.file, (gltf) => {
            const model = gltf.scene;
            model.traverse(node => { if (node.isMesh) { node.castShadow = true; } });
            model.name = config.name;
            model.userData.id = `model-${i}`;
            model.userData.modelIndex = i;
            model.userData.config = config;
            model.position.copy(config.position);
            model.rotation.y = config.rotationY;
            const hitbox = new THREE.Mesh(hitboxGeo, hitboxMat);
            hitbox.position.y = 4;
            model.add(hitbox);
            sceneContainerGroup.add(model);
            kowale.push(model);
            if (gltf.animations && gltf.animations.length) {
                const mixer = new THREE.AnimationMixer(model);
                const action = mixer.clipAction(gltf.animations[0]);
                model.userData.action = action;
                mixers.push(mixer);
                resetAnimation(model);
                action.play();
            }
        }, undefined, () => console.error(`Nie udało się załadować modelu: ${config.file}`));
    });
}

function animateCameraTransition(elapsedTime, isZoomingOut = false) {
    if (!cameraTransition.active) return;
    const phaseTime = elapsedTime - cameraTransition.startTime;
    let progress = Math.min(phaseTime / cameraTransition.duration, 1.0);
    const easedProgress = easeInOutCubic(progress);
    camera.position.lerpVectors(cameraTransition.startPos, cameraTransition.endPos, easedProgress);
    const currentLookAt = new THREE.Vector3().lerpVectors(cameraTransition.startLookAt, cameraTransition.endLookAt, easedProgress);
    camera.lookAt(currentLookAt);
    const fogStartNear = isZoomingOut ? 1 : 25;
    const fogEndNear = isZoomingOut ? 25 : 1;
    const fogStartFar = isZoomingOut ? 10 : 55;
    const fogEndFar = isZoomingOut ? 55 : 10;
    scene.fog.near = THREE.MathUtils.lerp(fogStartNear, fogEndNear, easedProgress);
    scene.fog.far = THREE.MathUtils.lerp(fogStartFar, fogEndFar, easedProgress);
    if (progress >= 1.0) {
        cameraTransition.active = false;
        if (isZoomingOut) {
            appState = 'main_scene';
            infoElement.style.opacity = '1';
        } else {
            appState = 'catalog_active';
            openCatalog(selectedCharacter.userData.config, startCameraZoomOut);
        }
    }
}

function startCameraZoomOut() {
    if (selectedCharacter) {
        removeHighlight();
        resetAnimation(selectedCharacter);
        selectedCharacter = null;
    }
    appState = 'transition_zoom_out';
    cameraTransition.active = true;
    cameraTransition.startTime = clock.getElapsedTime();
    const tempPos = cameraTransition.startPos.clone();
    cameraTransition.startPos.copy(cameraTransition.endPos);
    cameraTransition.endPos.copy(tempPos);
    const tempLookAt = cameraTransition.startLookAt.clone();
    cameraTransition.startLookAt.copy(cameraTransition.endLookAt);
    cameraTransition.endLookAt.copy(tempLookAt);
}

// ZMIANA: Usunięto całą funkcję animateFlicker()

function animateReveal(elapsedTime) {
    if (introAnimation.finished) return;
    const phaseTime = elapsedTime - introAnimation.revealStartTime;
    let totalProgress = phaseTime / introAnimation.revealDuration;
    const finalLightIntensity = 2.0;
    if (totalProgress >= 1.0) {
        introAnimation.finished = true;
        introAnimation.animatedPanels.forEach(panel => panel.material.emissiveIntensity = panel.userData.finalIntensity);
        panelLights.forEach(light => light.intensity = finalLightIntensity);
        appState = 'main_scene';
        infoElement.style.opacity = '1';
        return;
    }
    const stagger = 0.6;
    introAnimation.animatedPanels.forEach((panel, i) => {
        const panelProgress = Math.min(1.0, Math.max(0, (totalProgress - (i * stagger / modelConfig.length)) / (1.0 - (i * stagger / modelConfig.length))));
        const easedProgress = 1 - Math.pow(1 - panelProgress, 3);
        panel.material.emissiveIntensity = panel.userData.finalIntensity * easedProgress;
        const light = panelLights[i];
        if (light) { light.intensity = easedProgress * finalLightIntensity; }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function findModelFromIntersection(intersectedObject) {
    if (intersectedObject.userData.modelIndex !== undefined) {
        return kowale.find(k => k.userData.modelIndex === intersectedObject.userData.modelIndex);
    }
    let parent = intersectedObject;
    while (parent.parent && parent.userData.id === undefined) { parent = parent.parent; }
    return parent.userData.id ? parent : null;
}

function playHoverAnimation(model) {
    const { action, config } = model.userData;
    if (!action) return;
    const animConfig = config.animation;
    action.paused = false;
    action.setLoop(THREE.LoopRepeat, Infinity);
    if (animConfig.activeEndFrame) {
        const startTime = frameToTime(animConfig.activeStartFrame, animConfig.fps);
        action.time = startTime;
        model.userData.isLoopingSubclip = true;
    } else {
        model.userData.isLoopingSubclip = false;
        action.time = 0;
    }
    action.play();
}

function resetAnimation(model) {
    const { action, config } = model.userData;
    if (!action) return;
    model.userData.isLoopingSubclip = false;
    action.time = frameToTime(config.animation.idleFrame, config.animation.fps);
    action.paused = true;
}

function highlightModel(model) {
    spotlight.target = model;
    const lightOffset = new THREE.Vector3(0, 8, 5);
    const worldLightPosition = model.localToWorld(lightOffset);
    spotlight.position.copy(worldLightPosition);
    spotlight.visible = true;
    spotlight.target.updateMatrixWorld();
}

function removeHighlight() {
    spotlight.visible = false;
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
}