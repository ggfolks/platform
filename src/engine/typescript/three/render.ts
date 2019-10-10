import {
  AmbientLight, BoxBufferGeometry, BufferGeometry, CylinderBufferGeometry, DirectionalLight,
  Light as LightObject, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PerspectiveCamera,
  PlaneBufferGeometry, Scene, SphereBufferGeometry, WebGLRenderer,
} from "three"
import {SkeletonUtils} from "three/examples/jsm/utils/SkeletonUtils"
import {Color} from "../../../core/color"
import {Value} from "../../../core/react"
import {Disposer, NoopRemover, Remover} from "../../../core/util"
import {windowSize} from "../../../scene2/gl"
import {loadGLTF} from "../../../scene3/entity"
import {Model} from "../../game"
import {
  Camera, Light, LightType, Material, MaterialType, MeshRenderer, RenderEngine,
} from "../../render"
import {
  TypeScriptComponent, TypeScriptCube, TypeScriptCylinder, TypeScriptGameEngine,
  TypeScriptGameObject, TypeScriptMesh, TypeScriptMeshFilter, TypeScriptQuad, TypeScriptSphere,
  registerComponentType,
} from "../game"

const defaultCamera = new PerspectiveCamera()

/** A render engine that uses Three.js. */
export class ThreeRenderEngine implements RenderEngine {
  private readonly _disposer = new Disposer()

  readonly renderer = new WebGLRenderer()
  readonly scene = new Scene()
  readonly cameras :ThreeCamera[] = []

  constructor (readonly gameEngine :TypeScriptGameEngine, readonly root :HTMLElement) {
    gameEngine._renderEngine = this

    this._disposer.add(this.renderer)
    this._disposer.add(this.scene)

    // settings recommended for GLTF loader:
    // https://threejs.org/docs/index.html#examples/en/loaders/GLTFLoader
    this.renderer.gammaOutput = true
    this.renderer.gammaFactor = 2.2

    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.domElement.style.width = "100%"
    this.renderer.domElement.style.height = "100%"

    root.appendChild(this.renderer.domElement)
    this._disposer.add(() => root.removeChild(this.renderer.domElement))
    this._disposer.add(windowSize(window).onValue(() => {
      this.renderer.setSize(
        this.renderer.domElement.clientWidth,
        this.renderer.domElement.clientHeight,
        false,
      )
    }))

    this.scene.autoUpdate = false
  }

  createMaterial () :Material {
    return new ThreeMaterial()
  }

  update () {
    this.renderer.render(
      this.scene,
      this.cameras.length > 0 ? this.cameras[0].camera : defaultCamera,
    )
  }

  dispose () {
    this._disposer.dispose()
  }
}

type MaterialObject = MeshBasicMaterial | MeshStandardMaterial

class ThreeMaterial implements Material {
  private _type :MaterialType = "basic"
  private _color :Color
  private _materialObject :MaterialObject = new MeshBasicMaterial()

  get type () :MaterialType { return this._type }
  set type (type :MaterialType) {
    if (type === this._type) return
    this._type = type
    this._updateType()
  }

  get color () :Color { return this._color }
  set color (color :Color) { Color.copy(this._color, color) }

  get object () { return this._materialObject }

  constructor (public _meshRenderer? :ThreeMeshRenderer) {
    this._color = new Proxy(Color.fromRGB(1, 1, 1), {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._updateColor()
        return true
      },
      get: (obj, prop) => {
        return obj[prop]
      },
    })
  }

  dispose () {
    this._materialObject.dispose()
  }

  private _updateType () {
    this._materialObject.dispose()
    this._materialObject = this._type === "basic"
      ? new MeshBasicMaterial()
      : new MeshStandardMaterial()
    this._updateColor()
    if (this._meshRenderer) this._meshRenderer._updateMaterials()
  }

  private _updateColor () {
    this._materialObject.color.fromArray(this._color, 1)
    this._materialObject.opacity = this._color[0]
  }
}

abstract class ThreeObjectComponent extends TypeScriptComponent {

  abstract get object () :Object3D

  get renderEngine () :ThreeRenderEngine {
    return this.gameObject.gameEngine.renderEngine as ThreeRenderEngine
  }

  awake () {
    this._addObject()
  }

  onTransformChanged () {
    this._updateTransform()
  }

  dispose () {
    super.dispose()
    this._removeObject()
  }

  protected _removeObject () {
    this.renderEngine.scene.remove(this.object)
  }

  protected _addObject () {
    this.object.matrixAutoUpdate = false
    this.renderEngine.scene.add(this.object)
  }

  protected _updateTransform () {
    this.object.matrixWorld.fromArray(this.transform.localToWorldMatrix)
  }
}

const TypeScriptCubePrototype = TypeScriptCube.prototype as any
TypeScriptCubePrototype._bufferGeometry = new BoxBufferGeometry()

const TypeScriptCylinderPrototype = TypeScriptCylinder.prototype as any
TypeScriptCylinderPrototype._bufferGeometry = new CylinderBufferGeometry()

const TypeScriptQuadPrototype = TypeScriptQuad.prototype as any
TypeScriptQuadPrototype._bufferGeometry = new PlaneBufferGeometry()

const TypeScriptSpherePrototype = TypeScriptSphere.prototype as any
TypeScriptSpherePrototype._bufferGeometry = new SphereBufferGeometry()

const emptyGeometry = new BufferGeometry()

class ThreeMeshRenderer extends ThreeObjectComponent implements MeshRenderer {
  private _mesh = new Mesh()
  private _materials :ThreeMaterial[]

  get material () :Material { return this.materials[0] }
  set material (mat :Material) { this.materials[0] = mat as ThreeMaterial }

  get materials () :Material[] { return this._materials }
  set materials (mats :Material[]) {
    this._materials.length = mats.length
    for (let ii = 0; ii < mats.length; ii++) this._materials[ii] = mats[ii] as ThreeMaterial
  }

  constructor (gameObject :TypeScriptGameObject, type :string) {
    super(gameObject, type)

    this._materials = new Proxy([new ThreeMaterial(this)], {
      set: (obj, prop, value) => {
        if (value instanceof ThreeMaterial) value._meshRenderer = this
        obj[prop] = value
        this._updateMaterials()
        return true
      },
      get: (obj, prop) => {
        return obj[prop]
      },
    })
    this._updateMaterials()
    this._disposer.add(() => {
      for (const material of this._materials) material.dispose()
    })
  }

  awake () {
    super.awake()
    this._disposer.add(
      this.gameObject
        .getComponentValue<TypeScriptMeshFilter>("meshFilter")
        .switchMap(
          meshFilter => meshFilter
            ? meshFilter.meshValue
            : Value.constant<TypeScriptMesh|undefined>(undefined),
        )
        .onValue((mesh :any) => {
          this._mesh.geometry = (mesh && mesh._bufferGeometry) || emptyGeometry
        }),
    )
  }

  get object () :Object3D { return this._mesh }

  _updateMaterials () {
    this._mesh.material = this._materials.length === 1
      ? this._materials[0].object
      : this._materials.map(mat => mat.object)
  }
}
registerComponentType("meshRenderer", ThreeMeshRenderer)

class ThreeCamera extends ThreeObjectComponent implements Camera {
  private _perspectiveCamera = new PerspectiveCamera()

  get object () :Object3D { return this._perspectiveCamera }
  get camera () :PerspectiveCamera { return this._perspectiveCamera }

  get aspect () :number { return this._perspectiveCamera.aspect }
  set aspect (aspect :number) {
    if (this._perspectiveCamera.aspect === aspect) return
    this._perspectiveCamera.aspect = aspect
    this._perspectiveCamera.updateProjectionMatrix()
  }

  get fieldOfView () :number { return this._perspectiveCamera.fov }
  set fieldOfView (fov :number) {
    if (this._perspectiveCamera.fov === fov) return
    this._perspectiveCamera.fov = fov
    this._perspectiveCamera.updateProjectionMatrix()
  }

  awake () {
    super.awake()
    this.renderEngine.cameras.push(this)

    // for now, just use the renderer element aspect
    this._disposer.add(windowSize(window).onValue(() => {
      const element = this.renderEngine.renderer.domElement
      this.aspect = element.clientWidth / element.clientHeight
    }))
  }

  dispose () {
    super.dispose()
    this.renderEngine.cameras.splice(this.renderEngine.cameras.indexOf(this), 1)
  }
}
registerComponentType("camera", ThreeCamera)

class ThreeLight extends ThreeObjectComponent implements Light {
  private _lightType :LightType = "ambient"
  private _color :Color
  private _lightObject :LightObject = new AmbientLight()

  get lightType () :LightType { return this._lightType }
  set lightType (type :LightType) {
    if (type === this._lightType) return
    this._lightType = type
    this._updateLightType()
  }

  get color () :Color { return this._color }
  set color (color :Color) { Color.copy(this._color, color) }

  get object () :Object3D { return this._lightObject }

  constructor (gameObject :TypeScriptGameObject, type :string) {
    super(gameObject, type)

    this._color = new Proxy(Color.fromRGB(1, 1, 1), {
      set: (obj, prop, value) => {
        obj[prop] = value
        this._updateColor()
        return true
      },
      get: (obj, prop) => {
        return obj[prop]
      },
    })
  }

  private _updateLightType () {
    this._removeObject()
    this._lightObject = this._lightType === "ambient" ? new AmbientLight() : new DirectionalLight()
    this._updateColor()
    this._updateTransform()
    this._addObject()
  }

  private _updateColor () {
    this._lightObject.color.fromArray(this._color, 1)
  }
}
registerComponentType("light", ThreeLight)

class ThreeModel extends ThreeObjectComponent implements Model {
  private _url? :string
  private _object = new Object3D()
  private _urlRemover :Remover = NoopRemover

  get object () :Object3D { return this._object }

  get url () :string|undefined { return this._url }
  set url (url :string|undefined) {
    if (this._url === url) return
    this._url = url
    this._updateUrl()
  }

  dispose () {
    super.dispose()
    this._urlRemover()
  }

  private _updateUrl () {
    this._urlRemover()
    this._removeObject()
    if (!this._url) return
    this._urlRemover = loadGLTF(this._url).onValue(gltf => {
      this._removeObject()
      this._object = SkeletonUtils.clone(gltf.scene) as Object3D
      this._updateTransform()
      this._addObject()
    })
  }

  protected _updateTransform () {
    super._updateTransform()
    for (const child of this._object.children) child.updateMatrixWorld(true)
  }
}
registerComponentType("model", ThreeModel)
