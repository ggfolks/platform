import {
  BoxBufferGeometry, BufferGeometry, CylinderBufferGeometry, DirectionalLight, Mesh,
  MeshBasicMaterial, Object3D, PerspectiveCamera, PlaneBufferGeometry, Scene,
  SphereBufferGeometry, WebGLRenderer,
} from "three"
import {Color} from "../../../core/color"
import {Value} from "../../../core/react"
import {Disposer} from "../../../core/util"
import {windowSize} from "../../../scene2/gl"
import {Camera, Light, Material, MeshRenderer, RenderEngine} from "../../render"
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

class ThreeMaterial implements Material {
  private _color :Color
  _basicMaterial = new MeshBasicMaterial()

  get color () :Color { return this._color }
  set color (color :Color) { Color.copy(this._color, color) }

  get threeMaterial () { return this._basicMaterial }

  constructor () {
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
    this._basicMaterial.dispose()
  }

  private _updateColor () {
    this._basicMaterial.color.fromArray(this._color, 1)
    this._basicMaterial.opacity = this._color[0]
  }
}

abstract class ThreeObjectComponent extends TypeScriptComponent {

  abstract get object () :Object3D

  get renderEngine () :ThreeRenderEngine {
    return this.gameObject.gameEngine.renderEngine as ThreeRenderEngine
  }

  awake () {
    this.object.matrixAutoUpdate = false
    this.renderEngine.scene.add(this.object)
  }

  onTransformChanged () {
    this.object.matrixWorld.fromArray(this.transform.localToWorldMatrix)
  }

  dispose () {
    super.dispose()
    this.renderEngine.scene.remove(this.object)
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

    this._materials = new Proxy([new ThreeMaterial()], {
      set: (obj, prop, value) => {
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

  private _updateMaterials () {
    this._mesh.material = this._materials.length === 1
      ? this._materials[0].threeMaterial
      : this._materials.map(mat => mat.threeMaterial)
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
  private _directionalLight = new DirectionalLight()

  get object () :Object3D { return this._directionalLight }
}
registerComponentType("light", ThreeLight)
