import { ShaderMaterial, SRGBColorSpace, TextureLoader, Vector3, type Texture } from 'three';
import { subsolarPoint, toXYZ } from './geo';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D heightMap;
  uniform sampler2D waterMap;
  uniform sampler2D cloudMap;
  uniform vec3 sunDirection;
  uniform float realSun;
  uniform float cloudAmount;
  uniform float cloudShift;
  uniform float nightFill;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);

    // Relief : la normale est inclinée selon la pente de la carte d'altitude.
    vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0);
    float slopeEast = texture2D(heightMap, vUv + vec2(texel.x, 0.0)).r
                    - texture2D(heightMap, vUv - vec2(texel.x, 0.0)).r;
    float slopeNorth = texture2D(heightMap, vUv + vec2(0.0, texel.y)).r
                     - texture2D(heightMap, vUv - vec2(0.0, texel.y)).r;
    vec3 east = normalize(cross(vec3(0.0, 1.0, 0.0), normal) + vec3(1e-5, 0.0, 0.0));
    vec3 north = cross(normal, east);
    vec3 bumped = normalize(normal - (east * slopeEast + north * slopeNorth) * 6.0);

    // Sans soleil réel, le globe est éclairé uniformément depuis la caméra.
    vec3 light = normalize(mix(viewDirection, sunDirection, realSun));
    float sunHeight = dot(normal, light);
    float daylight = mix(1.0, smoothstep(-0.15, 0.22, sunHeight), realSun);
    float diffuse = mix(0.92, max(dot(bumped, light), 0.0), 0.75 + 0.25 * realSun);

    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    float water = texture2D(waterMap, vUv).r;

    // Reflet du soleil sur les océans.
    vec3 halfway = normalize(light + viewDirection);
    float specular = pow(max(dot(normal, halfway), 0.0), 90.0) * water * 0.55 * realSun;

    vec3 lit = day * (0.05 + 1.1 * diffuse) + vec3(1.0, 0.95, 0.85) * specular;
    vec3 dark = night * vec3(1.7, 1.45, 1.1) + day * nightFill;
    vec3 color = mix(dark, lit, daylight);

    // Liseré orangé du crépuscule le long du terminateur.
    float twilight =
      realSun * smoothstep(-0.12, 0.0, sunHeight) * (1.0 - smoothstep(0.0, 0.14, sunHeight));
    color += vec3(0.30, 0.11, 0.03) * twilight * 0.07;

    // Nuages, éclairés par le soleil et presque invisibles côté nuit.
    float cloud = texture2D(cloudMap, vec2(vUv.x + cloudShift, vUv.y)).a * cloudAmount;
    vec3 cloudColor = vec3(1.0) * (0.03 + 0.97 * daylight * (0.35 + 0.65 * max(sunHeight, 0.0)));
    color = mix(color, mix(cloudColor, vec3(1.0), 1.0 - realSun), cloud * 0.9);

    // Diffusion atmosphérique sur le limbe.
    float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
    color += vec3(0.25, 0.5, 1.0) * rim * 0.45 * (0.25 + 0.75 * daylight);

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * Matériau photo-réaliste de la Terre : alternance jour/nuit calculée d'après
 * la position réelle du Soleil, lumières des villes, relief, reflets sur les
 * océans, nuages et diffusion atmosphérique.
 */
export class EarthMaterial {
  readonly material: ShaderMaterial;
  private readonly sun = new Vector3();

  constructor(imageBase: string) {
    const loader = new TextureLoader();
    const load = (file: string, color: boolean): Texture => {
      const texture = loader.load(`${imageBase}${file}`);
      if (color) texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    };
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        dayMap: { value: load('earth-blue-marble.jpg', true) },
        nightMap: { value: load('earth-night.jpg', true) },
        heightMap: { value: load('earth-topology.png', false) },
        waterMap: { value: load('earth-water.png', false) },
        cloudMap: { value: load('clouds.png', false) },
        sunDirection: { value: this.sun },
        realSun: { value: 1 },
        cloudAmount: { value: 1 },
        cloudShift: { value: 0 },
        nightFill: { value: 0.025 },
      },
    });
    this.setDate(new Date());
  }

  setDate(date: Date): void {
    const { lat, lng } = subsolarPoint(date);
    const xyz = [0, 0, 0];
    toXYZ(lat, lng, 0, xyz);
    this.sun.set(xyz[0], xyz[1], xyz[2]).normalize();
  }

  setRealSun(on: boolean): void {
    this.material.uniforms.realSun.value = on ? 1 : 0;
  }

  /** Les nuages s'effacent quand on descend, pour laisser voir le sol. */
  setClouds(enabled: boolean, altitude: number): void {
    const fade = Math.min(1, Math.max(0, (altitude - 0.25) / 0.6));
    this.material.uniforms.cloudAmount.value = enabled ? fade : 0;
    // De près, on éclaircit un peu la face nocturne pour que le sol reste lisible.
    this.material.uniforms.nightFill.value = 0.025 + 0.2 * (1 - Math.min(1, altitude / 0.8));
  }

  /** Lente dérive des nuages ; `seconds` est le temps écoulé. */
  drift(seconds: number): void {
    this.material.uniforms.cloudShift.value = (seconds * 0.0006) % 1;
  }
}
