import { TilesRenderer } from '3d-tiles-renderer';
import {
  CesiumIonAuthPlugin,
  GLTFExtensionsPlugin,
  ReorientationPlugin,
  TileCompressionPlugin,
  TilesFadePlugin,
} from '3d-tiles-renderer/plugins';
import { PerspectiveCamera, Raycaster, Scene, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/** Identifiant Cesium ion du jeu « Google Photorealistic 3D Tiles ». */
const GOOGLE_PHOTOREALISTIC_ASSET = '2275207';
const DEG = Math.PI / 180;
const LOW_POWER =
  window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency ?? 8) <= 4;

export interface City3dCallbacks {
  /** Jeton refusé, quota dépassé ou réseau indisponible. */
  onError(message: string): void;
  onAttribution(text: string): void;
}

/**
 * Ville en 3D photo-réaliste (bâtiments, monuments et végétation texturés),
 * diffusée par Cesium ion. On tourne autour du lieu choisi, on s'en approche
 * et on se déplace en faisant glisser.
 */
export class City3dViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(55, 1, 5, 400_000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new Raycaster();
  private tiles: TilesRenderer | null = null;
  private reorient: ReorientationPlugin | null = null;
  private place = { lat: 0, lng: 0, height: 0 };
  private grounded = false;
  private frameCount = 0;
  /** Numéro de la boucle de rendu en cours ; en changer arrête l'ancienne. */
  private loop = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: City3dCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ antialias: !LOW_POWER });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW_POWER ? 1 : 1.5));
    this.renderer.setClearColor(0x9fc4e8);
    container.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 20_000;
    this.controls.maxPolarAngle = 86 * DEG;
    this.controls.zoomToCursor = true;

    new ResizeObserver(() => this.resize()).observe(container);
  }

  /** Ouvre la vue 3D centrée sur un lieu. */
  open(token: string, lat: number, lng: number): void {
    this.close();
    this.place = { lat, lng, height: 0 };
    this.grounded = false;

    const tiles = new TilesRenderer();
    tiles.registerPlugin(
      new CesiumIonAuthPlugin({
        apiToken: token,
        assetId: GOOGLE_PHOTOREALISTIC_ASSET,
        autoRefreshToken: true,
      }),
    );
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`),
      }),
    );
    this.reorient = new ReorientationPlugin({ lat: lat * DEG, lon: lng * DEG });
    tiles.registerPlugin(this.reorient);
    // Moins de détail sur tablette : nettement moins de données à charger.
    tiles.errorTarget = LOW_POWER ? 28 : 14;

    tiles.addEventListener('load-error', (event) => {
      const error = (event as unknown as { error?: Error }).error;
      this.callbacks.onError(error?.message ?? 'chargement impossible');
    });

    this.scene.add(tiles.group);
    this.tiles = tiles;
    this.camera.position.set(450, 380, 450);
    this.controls.target.set(0, 0, 0);
    this.resize();
    const loop = ++this.loop;
    requestAnimationFrame(() => this.frame(loop));
  }

  close(): void {
    this.loop++;
    if (!this.tiles) return;
    this.scene.remove(this.tiles.group);
    this.tiles.dispose();
    this.tiles = null;
  }

  /**
   * L'origine est placée au niveau de l'ellipsoïde ; le sol réel peut être des
   * centaines de mètres plus haut. Dès que des tuiles sont affichées, on mesure
   * l'altitude du terrain sous le point visé et on y recale la scène.
   */
  private snapToGround(): void {
    if (this.grounded || !this.tiles || !this.reorient) return;
    if (this.tiles.visibleTiles.size === 0) return;
    this.tiles.group.updateMatrixWorld(true);
    this.raycaster.set(new Vector3(0, 20_000, 0), new Vector3(0, -1, 0));
    const hit = this.raycaster.intersectObject(this.tiles.group, true)[0];
    if (!hit) return;
    this.grounded = true;
    this.place.height += hit.point.y;
    this.reorient.transformLatLonHeightToOrigin(
      this.place.lat * DEG,
      this.place.lng * DEG,
      this.place.height,
    );
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(loop: number): void {
    if (loop !== this.loop || !this.tiles) return;
    requestAnimationFrame(() => this.frame(loop));
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.setCamera(this.camera);
    this.tiles.update();
    this.renderer.render(this.scene, this.camera);
    // Le lancer de rayon est coûteux : on ne réessaie que de temps en temps.
    if (!this.grounded && this.frameCount++ % 10 === 0) this.snapToGround();
    const attribution = this.tiles.getAttributions()[0]?.value;
    this.callbacks.onAttribution(typeof attribution === 'string' ? attribution : '');
  }
}
