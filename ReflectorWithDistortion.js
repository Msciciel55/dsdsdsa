// --- START OF FILE ReflectorWithDistortion.js ---

import {
	Color,
	Matrix4,
	Mesh,
	PerspectiveCamera,
	Plane,
	ShaderMaterial,
	Uniform,
	Vector3,
	Vector4,
	WebGLRenderTarget
} from 'three';

class ReflectorWithDistortion extends Mesh {

	constructor( geometry, options = {} ) {

		super( geometry );

		this.isReflector = true;

		this.type = 'Reflector';

		const scope = this;

		const color = ( options.color !== undefined ) ? new Color( options.color ) : new Color( 0x7F7F7F );
		const textureWidth = options.textureWidth || 512;
		const textureHeight = options.textureHeight || 512;
		const clipBias = options.clipBias || 0;
		const shader = options.shader || ReflectorWithDistortion.ReflectorShader;
		const multisample = ( options.multisample !== undefined ) ? options.multisample : 4;

		//

		const reflectorPlane = new Plane();
		const normal = new Vector3();
		const reflectorWorldPosition = new Vector3();
		const cameraWorldPosition = new Vector3();
		const rotationMatrix = new Matrix4();
		const lookAtPosition = new Vector3( 0, 0, - 1 );
		const clipPlane = new Vector4();

		const view = new Vector3();
		const target = new Vector3();
		const q = new Vector4();

		const textureMatrix = new Matrix4();
		const virtualCamera = new PerspectiveCamera();

		const renderTarget = new WebGLRenderTarget( textureWidth, textureHeight, { multisample: multisample } );

		const material = new ShaderMaterial( {
			uniforms: UniformsUtils.clone( shader.uniforms ),
			fragmentShader: shader.fragmentShader,
			vertexShader: shader.vertexShader
		} );

		material.uniforms[ 'tDiffuse' ].value = renderTarget.texture;
		material.uniforms[ 'color' ].value = color;
		material.uniforms[ 'textureMatrix' ].value = textureMatrix;

		this.material = material;

		this.onBeforeRender = function ( renderer, scene, camera ) {

			reflectorWorldPosition.setFromMatrixPosition( scope.matrixWorld );
			cameraWorldPosition.setFromMatrixPosition( camera.matrixWorld );

			rotationMatrix.extractRotation( scope.matrixWorld );

			normal.set( 0, 0, 1 );
			normal.applyMatrix4( rotationMatrix );

			view.subVectors( reflectorWorldPosition, cameraWorldPosition );

			// Avoid rendering when reflector is facing away

			if ( view.dot( normal ) > 0 ) return;

			view.reflect( normal ).negate();
			view.add( reflectorWorldPosition );

			rotationMatrix.extractRotation( camera.matrixWorld );

			lookAtPosition.set( 0, 0, - 1 );
			lookAtPosition.applyMatrix4( rotationMatrix );
			lookAtPosition.add( cameraWorldPosition );

			target.subVectors( reflectorWorldPosition, lookAtPosition );
			target.reflect( normal ).negate();
			target.add( reflectorWorldPosition );

			virtualCamera.position.copy( view );
			virtualCamera.up.set( 0, 1, 0 );
			virtualCamera.up.applyMatrix4( rotationMatrix );
			virtualCamera.up.reflect( normal );
			virtualCamera.lookAt( target );

			virtualCamera.far = camera.far; // Used in WebGLBackground

			virtualCamera.updateMatrixWorld();
			virtualCamera.projectionMatrix.copy( camera.projectionMatrix );

			// Update the texture matrix
			textureMatrix.set(
				0.5, 0.0, 0.0, 0.5,
				0.0, 0.5, 0.0, 0.5,
				0.0, 0.0, 0.5, 0.5,
				0.0, 0.0, 0.0, 1.0
			);
			textureMatrix.multiply( virtualCamera.projectionMatrix );
			textureMatrix.multiply( virtualCamera.matrixWorldInverse );
			textureMatrix.multiply( scope.matrixWorld );

			// Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
			// Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
			reflectorPlane.setFromNormalAndCoplanarPoint( normal, reflectorWorldPosition );
			reflectorPlane.applyMatrix4( virtualCamera.matrixWorldInverse );

			clipPlane.set( reflectorPlane.normal.x, reflectorPlane.normal.y, reflectorPlane.normal.z, reflectorPlane.constant );

			const projectionMatrix = virtualCamera.projectionMatrix;

			q.x = ( Math.sign( clipPlane.x ) + projectionMatrix.elements[ 8 ] ) / projectionMatrix.elements[ 0 ];
			q.y = ( Math.sign( clipPlane.y ) + projectionMatrix.elements[ 9 ] ) / projectionMatrix.elements[ 5 ];
			q.z = - 1.0;
			q.w = ( 1.0 + projectionMatrix.elements[ 10 ] ) / projectionMatrix.elements[ 14 ];

			// Calculate the scaled plane vector
			clipPlane.multiplyScalar( 2.0 / clipPlane.dot( q ) );

			// Replacing the third row of the projection matrix
			projectionMatrix.elements[ 2 ] = clipPlane.x;
			projectionMatrix.elements[ 6 ] = clipPlane.y;
			projectionMatrix.elements[ 10 ] = clipPlane.z + 1.0 - clipBias;
			projectionMatrix.elements[ 14 ] = clipPlane.w;

			// Render
			const currentRenderTarget = renderer.getRenderTarget();

			const currentXrEnabled = renderer.xr.enabled;
			const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

			scope.visible = false;

			renderer.xr.enabled = false; // Avoid camera modification
			renderer.shadowMap.autoUpdate = false; // Avoid re-rendering shadows

			renderer.setRenderTarget( renderTarget );

			renderer.state.buffers.depth.setMask( true ); // make sure the depth buffer is writable so it can be cleared

			if ( renderer.autoClear === false ) renderer.clear();
			renderer.render( scene, virtualCamera );

			renderer.xr.enabled = currentXrEnabled;
			renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

			renderer.setRenderTarget( currentRenderTarget );

			// Restore viewport

			const viewport = camera.viewport;

			if ( viewport !== undefined ) {

				renderer.state.viewport( viewport );

			}

			scope.visible = true;

		};

		this.getRenderTarget = function () {

			return renderTarget;

		};

		this.dispose = function () {

			renderTarget.dispose();
			scope.material.dispose();

		};

	}

}

ReflectorWithDistortion.ReflectorShader = {
    // ZMIENIONO: Dodano nowe uniformy do kontroli efektów
	uniforms: {
        'color': { value: null },
        'tDiffuse': { value: null },
        'textureMatrix': { value: null },
        'tNormal': { value: null }, // Tekstura normal map do zniekształceń
        'time': { value: 0.0 }, // Czas do animacji fal
        'distortionScale': { value: 0.03 } // Siła zniekształcenia
	},

	vertexShader: /* glsl */`
		uniform mat4 textureMatrix;
		varying vec4 vUv;

		void main() {
			vUv = textureMatrix * vec4( position, 1.0 );
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}`,

	fragmentShader: /* glsl */`
		uniform vec3 color;
		uniform sampler2D tDiffuse;
        uniform sampler2D tNormal;
        uniform float time;
        uniform float distortionScale;
		varying vec4 vUv;

		void main() {
            // Przesuwamy teksturę fali w czasie, aby stworzyć animację
            vec2 scrolledNormalUV = vUv.xy / vUv.w + vec2(time * 0.05, 0.0);
			vec4 normalColor = texture2D(tNormal, scrolledNormalUV);

            // Używamy normal mapy do zniekształcenia koordynatów odbicia
            vec2 distortedUv = vUv.xy / vUv.w + ((normalColor.rg - 0.5) * 2.0) * distortionScale;
            vec4 diffuse = texture2D(tDiffuse, distortedUv);

            // Obliczamy współczynnik zanikania w oparciu o odległość (oś Y w przestrzeni odbicia)
            // smoothstep tworzy płynne przejście. Odbicie jest pełne do 30% dystansu i zanika do zera przy 95%.
            float fade = smoothstep(0.3, 0.95, vUv.y / vUv.w);
            
            // Mieszamy kolor podłogi z kolorem odbicia, używając współczynnika zanikania
			gl_FragColor = mix(vec4(color, 1.0), vec4(diffuse.rgb, diffuse.a), fade);
		}`

};

// Helper z Three.js, potrzebny do klonowania uniformów
const UniformsUtils = {
	clone: function ( uniforms_src ) {
		const uniforms_dst = {};
		for ( const name in uniforms_src ) {
			uniforms_dst[ name ] = {};
			for ( const p in uniforms_src[ name ] ) {
				const p_src = uniforms_src[ name ][ p ];
				if ( p_src && ( p_src.isColor || p_src.isMatrix3 || p_src.isMatrix4 || p_src.isVector2 || p_src.isVector3 || p_src.isVector4 || p_src.isTexture || p_src.isQuaternion ) ) {
					uniforms_dst[ name ][ p ] = p_src.clone();
				} else if ( Array.isArray( p_src ) ) {
					uniforms_dst[ name ][ p ] = p_src.slice();
				} else {
					uniforms_dst[ name ][ p ] = p_src;
				}
			}
		}
		return uniforms_dst;
	}
};


export { ReflectorWithDistortion };

// --- END OF FILE ReflectorWithDistortion.js ---