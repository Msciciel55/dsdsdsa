// --- START OF FILE catalog.js (WERSJA POPRAWIONA) ---

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let allItems = [];
let onExitCallback = null;
let categoryTree = {};
let currentPath = [];
let animationTimeline = null;
let itemMaterials = []; 
let clock = new THREE.Clock();

const catalogContainer = document.getElementById('catalog-view');
const categoryList = document.getElementById('category-list');
const itemsTitle = document.getElementById('items-title');
const gridOrPreviewContainer = document.getElementById('item-grid-or-preview');
const backToMainBtn = document.getElementById('back-to-main');
const searchInput = document.getElementById('item-search-input');
const fullscreenPreviewScene = document.getElementById('fullscreen-preview-scene');

let itemScene, itemCamera, itemRenderer, currentItemModel, isAnimatingItem = false;

// --- GŁÓWNA FUNKCJA OTWIERAJĄCA KATALOG (bez zmian) ---
export function openCatalog(characterConfig, onExit) {
    onExitCallback = onExit;
    allItems = characterConfig.items;
    
    categoryTree = buildCategoryTree(allItems);
    renderCategoryList();
    showItemsForPath([]);

    catalogContainer.style.display = 'flex';
    setTimeout(() => {
        catalogContainer.style.opacity = '1';
        catalogContainer.classList.add('is-open');
    }, 10);
}

function hideCatalog() {
    catalogContainer.style.opacity = '0';
    catalogContainer.classList.remove('is-open');
    setTimeout(() => {
        catalogContainer.style.display = 'none';
        cleanupPreview();
        if (onExitCallback) {
            onExitCallback();
        }
    }, 500);
}

// --- LOGIKA KATEGORII I SIATKI (bez zmian) ---
function buildCategoryTree(items) {
    const tree = {};
    items.forEach(item => {
        let currentLevel = tree;
        item.categoryPath.forEach(part => {
            if (!currentLevel[part]) { currentLevel[part] = {}; }
            currentLevel = currentLevel[part];
        });
    });
    return tree;
}

function renderCategoryList() {
    categoryList.innerHTML = '';
    const allLi = document.createElement('li');
    allLi.textContent = "Wszystkie";
    allLi.dataset.path = JSON.stringify([]);
    allLi.onclick = (e) => {
        e.stopPropagation();
        categoryList.querySelectorAll('.expanded').forEach(el => el.classList.remove('expanded'));
        categoryList.querySelectorAll('ul').forEach(ul => ul.style.display = 'none');
        showItemsForPath([]);
        setActiveCategory(allLi);
    };
    categoryList.appendChild(allLi);
    renderCategoryLevel(categoryTree, categoryList, []);
    setActiveCategory(allLi);
}

function renderCategoryLevel(treeNode, parentElement, path) {
    Object.keys(treeNode).sort().forEach(key => {
        const newPath = [...path, key];
        const li = document.createElement('li');
        li.textContent = key;
        li.dataset.path = JSON.stringify(newPath);
        const children = Object.keys(treeNode[key]);
        let sublist = null;
        if (children.length > 0) {
            li.classList.add('has-children');
            sublist = document.createElement('ul');
            sublist.style.display = 'none';
            renderCategoryLevel(treeNode[key], sublist, newPath);
            li.appendChild(sublist);
        }
        li.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCurrentlyExpanded = li.classList.contains('expanded');
            const hasChildren = li.classList.contains('has-children');
            const parentUl = li.parentElement;
            for (const sibling of parentUl.children) {
                if (sibling !== li && sibling.classList.contains('has-children')) {
                    sibling.classList.remove('expanded');
                    sibling.querySelectorAll('ul').forEach(ul => ul.style.display = 'none');
                    sibling.querySelectorAll('.expanded').forEach(expandedEl => expandedEl.classList.remove('expanded'));
                }
            }
            if (hasChildren) {
                if (isCurrentlyExpanded) {
                    li.classList.remove('expanded');
                    sublist.style.display = 'none';
                } else {
                    li.classList.add('expanded');
                    sublist.style.display = 'block';
                }
            }
            showItemsForPath(newPath);
            setActiveCategory(li);
        });
        parentElement.appendChild(li);
    });
}

function setActiveCategory(activeElement) {
    document.querySelectorAll('#category-list li').forEach(li => li.classList.remove('active'));
    if(activeElement) activeElement.classList.add('active');
}

async function showItemsForPath(path) {
    await cleanupPreview();
    currentPath = path;
    const itemsToShow = path.length === 0 ? allItems : allItems.filter(item => {
        return path.every((segment, i) => item.categoryPath[i] === segment);
    });
    const title = path.length > 0 ? path.join(' > ') : "Wszystkie przedmioty";
    itemsTitle.textContent = title;
    renderItemGrid(itemsToShow);
    searchInput.value = '';
}

async function showItemsForSearch(searchTerm) {
    await cleanupPreview();
    const lowerCaseTerm = searchTerm.toLowerCase();
    const itemsToShow = allItems.filter(item => 
        item.name.toLowerCase().includes(lowerCaseTerm) || 
        item.description.toLowerCase().includes(lowerCaseTerm)
    );
    itemsTitle.textContent = `Wyniki dla: "${searchTerm}"`;
    renderItemGrid(itemsToShow);
    setActiveCategory(null);
}

function renderItemGrid(items) {
    const grid = document.createElement('div');
    grid.className = 'item-grid-book';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'item-card-book';
        card.innerHTML = `<img src="${item.cardImage}" alt="${item.name}"><h3>${item.name}</h3>`;
        card.onclick = () => showItemPreview(item);
        grid.appendChild(card);
    });
    gridOrPreviewContainer.innerHTML = '';
    if (items.length === 0) {
        gridOrPreviewContainer.innerHTML = '<p style="text-align: center; margin-top: 20px;">Brak przedmiotów do wyświetlenia.</p>';
    } else {
        gridOrPreviewContainer.appendChild(grid);
    }
}

function cleanupPreview() {
    return new Promise(resolve => {
        if (!fullscreenPreviewScene.classList.contains('visible') || gsap.isTweening(fullscreenPreviewScene)) {
            fullscreenPreviewScene.innerHTML = '';
            fullscreenPreviewScene.classList.remove('visible');
            catalogContainer.classList.remove('preview-active');
            cleanupItemViewer();
            animationTimeline = null;
            resolve();
            return;
        }

        if (animationTimeline) {
            animationTimeline.kill();
            animationTimeline = null;
        }
        
        const descriptionContainer = document.getElementById('item-description-container-animated');
        const backButton = document.getElementById('back-to-book-button');
        const magicCircle = document.getElementById('magic-circle-container');

        const outTimeline = gsap.timeline({
            onComplete: () => {
                fullscreenPreviewScene.innerHTML = '';
                fullscreenPreviewScene.classList.remove('visible');
                catalogContainer.classList.remove('preview-active');
                cleanupItemViewer();
                resolve();
            }
        });

        outTimeline.to([descriptionContainer, backButton, magicCircle], {
            opacity: 0,
            duration: 0.5,
            ease: 'power2.in'
        }, 0);

        if (itemMaterials.length > 0) {
            const firstMat = itemMaterials[0];
            const endVal = firstMat.userData.revealBounds.min - 0.2; // - bufor
            
            outTimeline.to(itemMaterials.map(m => m.uniforms.u_revealProgress), {
                value: endVal,
                duration: 1.0,
                ease: 'power2.inOut'
            }, 0);
        }
    });
}

async function showItemPreview(item) {
    await cleanupPreview();
    
    // ZMIANA: Wyświetl obrazek przedmiotu na prawej stronie księgi
    itemsTitle.textContent = item.name;
    gridOrPreviewContainer.innerHTML = ''; // Wyczyść siatkę
    
    const imageContainer = document.createElement('div');
    imageContainer.className = 'book-preview-image-container';

    const previewImage = document.createElement('img');
    previewImage.src = item.cardImage; // Użyj obrazka webp z danych przedmiotu
    previewImage.alt = `Podgląd ${item.name}`;

    imageContainer.appendChild(previewImage);
    gridOrPreviewContainer.appendChild(imageContainer);
    // KONIEC ZMIANY

    fullscreenPreviewScene.innerHTML = `
        <div id="magic-circle-container"></div>
        <div id="item-model-container-preview"></div>
        <div id="item-description-container-animated"></div>
        <button id="back-to-book-button">Powrót do Księgi</button>
    `;
    
    const svgCode = `<svg id="magic-circle-svg" viewBox="100 100 300 300" fill="none" xmlns="http://www.w3.org/2000/svg"><style>#magic-circle-svg path, #magic-circle-svg circle { stroke: #FFD700; stroke-width: 10; filter: drop-shadow(0 0 2px #FFD700) drop-shadow(0 0 5px #F5B041); transition: filter 0.3s ease-in-out; } #magic-circle-svg.is-glowing path, #magic-circle-svg.is-glowing circle { filter: drop-shadow(0 0 8px #fff) drop-shadow(0 0 20px #FFD700) drop-shadow(0 0 35px #F5B041); } #magic-circle-svg path.cienki { stroke: #FFD700; stroke-width: 5; fill="#FFD700"; filter: drop-shadow(0 0 2px #FFD700) drop-shadow(0 0 5px #F5B041); transition: filter 0.3s ease-in-out; } #magic-circle-svg.is-glowing path.cienki { filter: drop-shadow(0 0 8px #fff) drop-shadow(0 0 20px #FFD700) drop-shadow(0 0 35px #F5B041); }</style><circle cx="250" cy="250" r="240" /><path d="M 250 480 L 115 65 L 469 321 L 31 321 L 385 65 Z" /><path class="cienki" d="M0 0 C4.96423737 0.58174657 8.73451854 2.81820337 13 5.25 C13.69867188 5.63285156 14.39734375 6.01570312 15.1171875 6.41015625 C20.5103591 9.45271909 24.52341558 12.78512337 28 18 C29.63806437 24.34554936 30.15482645 31.75959272 28 38 C23.87838437 43.01284249 17.84448898 45.7991369 12.18847656 48.765625 C8.42696136 50.88724714 5.54183558 53.69087114 2.43359375 56.671875 C1 58 1 58 0 58 C-0.5625 55.3671875 -0.5625 55.3671875 0 52 C2.73463446 49.64042825 5.8987276 47.96097659 9 46.125 C14.94103389 42.44970558 14.94103389 42.44970558 18.90087891 36.92089844 C19.96658463 31.19809772 19.09026126 25.67152671 16.8984375 20.30078125 C14.21223657 17.04528259 11.05823136 15.53063765 7.3125 13.6875 C6.61060547 13.32849609 5.90871094 12.96949219 5.18554688 12.59960938 C3.46320595 11.720864 1.73240098 10.85874243 0 10 C0 6.7 0 3.4 0 0 Z " transform="translate(261,242)"/><path class="cienki" d="M0 0 C0 1.65 0 3.3 0 5 C-1.7634375 5.7425 -1.7634375 5.7425 -3.5625 6.5 C-10.90211126 10.18281913 -15.40012995 16.34482708 -18 24 C-20.16561288 31.67808205 -19.73233875 41.08358784 -15.8125 48.13671875 C-11.83831559 53.80641119 -6.64996099 58.78334634 0 61 C0 63.64 0 66.28 0 69 C-9.39229464 66.74584929 -17.03661487 61.11993292 -22.328125 52.94921875 C-27.21217172 43.56383047 -28.57636947 33.94274221 -25.75 23.6875 C-24.38765383 19.64523342 -22.61133241 16.40264526 -20 13 C-19.4121875 12.19691406 -18.824375 11.39382812 -18.21875 10.56640625 C-15.833381 7.80727345 -13.53608766 6.15552602 -10.4375 4.25 C-9.48746094 3.65703125 -8.53742188 3.0640625 -7.55859375 2.453125 C-4.9923641 0.99566327 -2.98332387 0 0 0 Z " transform="translate(244,203)"/><path class="cienki" d="M0 0 C0 23.43 0 46.86 0 71 C-5.94736842 65.05263158 -5.94736842 65.05263158 -7 62 C-6.67 61.34 -6.34 60.68 -6 60 C-5.88097188 58.30536742 -5.82285313 56.60628878 -5.79467773 54.90771484 C-5.77473251 53.84676605 -5.75478729 52.78581726 -5.73423767 51.69271851 C-5.71752518 50.54373077 -5.70081268 49.39474304 -5.68359375 48.2109375 C-5.66281265 47.03737701 -5.64203156 45.86381653 -5.62062073 44.6546936 C-5.55508017 40.89485696 -5.49621924 37.13494878 -5.4375 33.375 C-5.39431908 30.83072168 -5.35070493 28.28645067 -5.30664062 25.7421875 C-5.19939418 19.49486793 -5.0976362 13.24747674 -5 7 C-6.32 6.67 -7.64 6.34 -9 6 C-7.68969568 4.99712471 -6.37669473 3.99777175 -5.0625 3 C-4.33160156 2.443125 -3.60070312 1.88625 -2.84765625 1.3125 C-1 0 -1 0 0 0 Z " transform="translate(256,241)"/><path class="cienki" d="M0 0 C5 4 5 4 5.26953125 6.140625 C4.84635417 8.09375 4.42317708 10.046875 4 12 C4.72832031 11.77054687 5.45664063 11.54109375 6.20703125 11.3046875 C9.86616601 10.90550916 10.83994221 11.87519401 13.6875 14.125 C18.56833338 17.78745993 23.48475759 20.39995715 29 23 C29 26.3 29 29.6 29 33 C25.60483143 31.72844318 22.62087899 30.26917442 19.56640625 28.3203125 C18.75236328 27.80339844 17.93832031 27.28648437 17.09960938 26.75390625 C16.26236328 26.21636719 15.42511719 25.67882812 14.5625 25.125 C13.72912109 24.59519531 12.89574219 24.06539063 12.03710938 23.51953125 C7.65574642 20.72792766 3.32377228 17.88251486 -1 15 C-0.67 10.05 -0.34 5.1 0 0 Z " transform="translate(215,267)"/><path class="cienki" d="M0 0 C0.61875 0.78375 1.2375 1.5675 1.875 2.375 C3.89858661 4.96837647 3.89858661 4.96837647 6 7 C5.01 8.485 5.01 8.485 4 10 C3.68004129 12.85850566 3.68004129 12.85850566 3.69140625 16.09375 C3.66626953 17.28871094 3.64113281 18.48367187 3.61523438 19.71484375 C3.58007884 22.23822986 3.54882862 24.7616734 3.52148438 27.28515625 C3.49505859 28.48011719 3.46863281 29.67507812 3.44140625 30.90625 C3.42795166 32.00259766 3.41449707 33.09894531 3.40063477 34.22851562 C3 37 3 37 1.59741211 38.88085938 C0 40 0 40 -2 40 C-2.01458252 39.1121582 -2.02916504 38.22431641 -2.04418945 37.30957031 C-2.10534534 34.00672038 -2.17951378 30.70469085 -2.26245117 27.40234375 C-2.29564794 25.97472086 -2.32369631 24.54696837 -2.34643555 23.11914062 C-2.38008013 21.06324185 -2.43239562 19.00852488 -2.48828125 16.953125 C-2.51446533 15.71723633 -2.54064941 14.48134766 -2.56762695 13.20800781 C-3.02076282 9.8459495 -3.71142196 8.44043945 -6 6 C-5.195625 5.38125 -4.39125 4.7625 -3.5625 4.125 C-0.96125481 2.25835959 -0.96125481 2.25835959 0 0 Z " transform="translate(253,191)"/><path class="cienki" d="M0 0 C5.44907119 2.16538254 10.25139177 4.84830648 15.1875 8 C15.88552734 8.43828125 16.58355469 8.8765625 17.30273438 9.328125 C20.65590375 11.44658786 23.81751388 13.61313541 27 16 C25.02 18.97 23.04 21.94 21 25 C14 15.66666667 14 15.66666667 14 12 C13.01 11.67 12.02 11.34 11 11 C11 10.34 11 9.68 11 9 C10.29875 8.731875 9.5975 8.46375 8.875 8.1875 C5.8350176 6.9318551 2.9272226 5.49764877 0 4 C0 2.68 0 1.36 0 0 Z " transform="translate(261,203)"/><path class="cienki" d="M0 0 C1.1484375 2.0546875 1.1484375 2.0546875 2 4 C0.73308493 4.67408308 -0.53870749 5.33900497 -1.8125 6 C-2.52019531 6.37125 -3.22789062 6.7425 -3.95703125 7.125 C-6 8 -6 8 -9 8 C-9 5.69 -9 3.38 -9 1 C-5.69708067 -1.07961587 -3.69218461 -1.36027854 0 0 Z " transform="translate(270,264)"/></svg>`;
    
    const circleContainer = document.getElementById('magic-circle-container');
    circleContainer.innerHTML = svgCode;
    const svgElement = document.getElementById('magic-circle-svg');
    const pathsToAnimate = svgElement.querySelectorAll('path, circle');

    pathsToAnimate.forEach(path => {
        const length = path.getTotalLength();
        path.style.strokeDasharray = length;
        path.style.strokeDashoffset = length;
    });

    const descriptionContainer = document.getElementById('item-description-container-animated');
    descriptionContainer.innerHTML = `<h2>${item.name}</h2>`;
    item.description.split('\n').forEach(line => {
        if (line.trim() !== '') {
            const lineDiv = document.createElement('p');
            lineDiv.className = 'description-line';
            lineDiv.textContent = line;
            descriptionContainer.appendChild(lineDiv);
        }
    });

    const modelContainer = document.getElementById('item-model-container-preview');
    const itemModel = await initItemViewer(item.modelFile, modelContainer);
    if (!itemModel) return;

    catalogContainer.classList.add('preview-active');
    fullscreenPreviewScene.classList.add('visible');

    animationTimeline = gsap.timeline();
    animationTimeline
        .to(pathsToAnimate, { strokeDashoffset: 0, duration: 2.0, ease: 'power1.inOut', stagger: 0.2 }, 0.5)
        .add(() => svgElement.classList.add('is-glowing'), "-=0.5")
        
        .to(itemMaterials.map(m => m.uniforms.u_revealProgress), {
            value: (i, target) => itemMaterials[i].userData.revealBounds.max + 0.2,
            duration: 2.0,
            ease: 'power2.out',
            stagger: 0.05
        }, ">0.3")
        
        .fromTo('#item-description-container-animated',
            { opacity: 0, left: '50%', top: '50%', xPercent: -50, yPercent: -50, scale: 0.3, filter: 'blur(10px)' },
            { opacity: 1, x: 350, y: -150, scale: 1, filter: 'blur(0px)', duration: 1.2, ease: 'power3.out' },
            "-=0.7"
        )
        .to('.description-line', { opacity: 1, stagger: 0.1, duration: 0.5, ease: 'power1.in' }, "-=0.8")
        .to('#back-to-book-button', { opacity: 1, duration: 0.5 }, "-=0.5")
        .add(() => svgElement.classList.remove('is-glowing'), "-=0.5");

    document.getElementById('back-to-book-button').onclick = () => cleanupPreview().then(() => showItemsForPath(currentPath));
}

const noiseTexture = new THREE.TextureLoader().load('images/cloud.png');
noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;

function initItemViewer(modelPath, container) {
    return new Promise(resolve => {
        cleanupItemViewer();
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) { resolve(null); return; }

        itemScene = new THREE.Scene();
        itemCamera = new THREE.PerspectiveCamera(50, rect.width / rect.height, 0.1, 100);
        itemCamera.position.z = 3.5;
        itemScene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const dirLight = new THREE.DirectionalLight(0xffffff, 3.0);
        dirLight.position.set(5, 10, 7.5);
        itemScene.add(dirLight);
        itemRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        itemRenderer.setSize(rect.width, rect.height);
        itemRenderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(itemRenderer.domElement);

        const loader = new GLTFLoader();
        loader.load(modelPath, (gltf) => {
            currentItemModel = gltf.scene;

            const globalBox = new THREE.Box3().setFromObject(currentItemModel);
            const globalSize = globalBox.getSize(new THREE.Vector3()).length();
            const globalCenter = globalBox.getCenter(new THREE.Vector3());
            const scale = 2.0 / globalSize;

            currentItemModel.scale.set(scale, scale, scale);
            currentItemModel.position.sub(globalCenter.multiplyScalar(scale));
            currentItemModel.rotation.x = -75;

            currentItemModel.traverse(child => {
                if (child.isMesh) {
                    const originalMaterial = child.material;
                    child.geometry.computeBoundingBox();
                    const box = child.geometry.boundingBox;
                    const revealBounds = { min: box.min.y, max: box.max.y };
                    
                    const customMaterial = new THREE.MeshStandardMaterial({
                        color: originalMaterial.color, map: originalMaterial.map,
                        metalness: originalMaterial.metalness, roughness: originalMaterial.roughness,
                        normalMap: originalMaterial.normalMap,
                    });
                    customMaterial.userData.revealBounds = revealBounds;

                    customMaterial.onBeforeCompile = (shader) => {
                        shader.uniforms.u_time = { value: 0 };
                        shader.uniforms.u_noiseTexture = { value: noiseTexture };
                        shader.uniforms.u_revealProgress = { value: revealBounds.min - 0.2 }; // Zaczynamy lekko poniżej
                        shader.uniforms.u_revealBounds = { value: new THREE.Vector2(revealBounds.min, revealBounds.max) };
                        shader.uniforms.u_glowColor = { value: new THREE.Color(0xffd700) };

                        shader.vertexShader = 'varying vec3 vPosition;\n' + shader.vertexShader;
                        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPosition = position;');

                        shader.fragmentShader = 'uniform float u_time;\n' + 'uniform sampler2D u_noiseTexture;\n' + 'uniform float u_revealProgress;\n' + 'uniform vec2 u_revealBounds;\n' + 'uniform vec3 u_glowColor;\n' + 'varying vec3 vPosition;\n' + shader.fragmentShader;
                        shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
                                float noiseValue = texture2D(u_noiseTexture, vPosition.xz * 0.5 + u_time * 0.1).r;
                                float height = u_revealBounds.y - u_revealBounds.x;
                                
                                // Bardziej subtelna, estetyczna siła nierówności
                                float noisyRevealLine = u_revealProgress + (noiseValue - 0.5) * 0.3 * height;
                                
                                if (vPosition.y > noisyRevealLine) {
                                    discard;
                                }

                                // Efekt blasku na krawędzi
                                float glowWidth = 0.05 * height; // Szerokość blasku (mniejsza jest lepsza)
                                
                                // --- TUTAJ JEST KLUCZOWA POPRAWKA ---
                                // Obliczamy zanikanie blasku od 1 (na krawędzi) do 0 (poniżej krawędzi)
                                float glowFalloff = 1.0 - smoothstep(0.0, glowWidth, noisyRevealLine - vPosition.y);
                                
                                vec3 finalColor = gl_FragColor.rgb;
                                finalColor = mix(finalColor, u_glowColor, glowFalloff);

                                gl_FragColor = vec4(finalColor, 1.0);
                                #include <dithering_fragment>
                            `);
                        customMaterial.uniforms = shader.uniforms;
                    };
                    child.material = customMaterial;
                    itemMaterials.push(customMaterial);
                }
            });
            itemScene.add(currentItemModel);
            isAnimatingItem = true;
            animateItem();
            resolve(currentItemModel);
        }, undefined, () => {
            container.innerHTML = '<p>Błąd ładowania modelu</p>'; resolve(null);
        });
    });
}

function cleanupItemViewer() {
    isAnimatingItem = false;
    if (itemRenderer) {
        itemRenderer.dispose();
        const domElement = itemRenderer.domElement;
        if (domElement && domElement.parentNode) {
            domElement.parentNode.removeChild(domElement);
        }
    }
    currentItemModel = itemRenderer = itemScene = itemCamera = null;
    itemMaterials = [];
}

function animateItem() {
    if (!isAnimatingItem) return;
    requestAnimationFrame(animateItem);
    const delta = clock.getDelta();
    
    if (currentItemModel) {
        currentItemModel.rotation.y += 0.005;
        itemMaterials.forEach(mat => {
            if (mat.uniforms && mat.uniforms.u_time) {
                mat.uniforms.u_time.value += delta;
            }
        });
    }
    if (itemRenderer && itemScene && itemCamera) {
        itemRenderer.render(itemScene, itemCamera);
    }
}

function handleEscKey(event) {
    if (event.key === 'Escape' && fullscreenPreviewScene.classList.contains('visible')) {
        const backButton = document.getElementById('back-to-book-button');
        if (backButton) { backButton.click(); }
    } else if (event.key === 'Escape' && catalogContainer.style.display === 'flex') {
        hideCatalog();
    }
}

backToMainBtn.addEventListener('click', hideCatalog);
document.addEventListener('keydown', handleEscKey);
searchInput.addEventListener('input', (e) => showItemsForSearch(e.target.value.trim()));