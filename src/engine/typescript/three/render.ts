import {PerspectiveCamera, Scene, WebGLRenderer} from "three"
import {Disposer} from "../../../core/util"
import {windowSize} from "../../../scene2/gl"
import {Camera, MeshRenderer, RenderEngine} from "../../render"
import {TypeScriptComponent, registerComponentType} from "../game"

const defaultCamera = new PerspectiveCamera()

/** A render engine that uses Three.js. */
export class ThreeRenderEngine implements RenderEngine {
  private _disposer = new Disposer()
  private _renderer = new WebGLRenderer()
  private _scene = new Scene()

  constructor (readonly root :HTMLElement) {
    this._disposer.add(this._renderer)

    // settings recommended for GLTF loader:
    // https://threejs.org/docs/index.html#examples/en/loaders/GLTFLoader
    this._renderer.gammaOutput = true
    this._renderer.gammaFactor = 2.2

    this._renderer.setPixelRatio(window.devicePixelRatio)
    this._renderer.domElement.style.width = "100%"
    this._renderer.domElement.style.height = "100%"

    root.appendChild(this._renderer.domElement)
    this._disposer.add(() => root.removeChild(this._renderer.domElement))
    this._disposer.add(windowSize(window).onValue(() => {
      this._renderer.setSize(
        this._renderer.domElement.clientWidth,
        this._renderer.domElement.clientHeight,
        false,
      )
    }))
  }

  update () {
    this._renderer.render(this._scene, defaultCamera)
  }

  dispose () {
    this._disposer.dispose()
  }
}

class ThreeMeshRenderer extends TypeScriptComponent implements MeshRenderer {
}
registerComponentType("meshRenderer", ThreeMeshRenderer)

class ThreeCamera extends TypeScriptComponent implements Camera {
  private _perspectiveCamera = new PerspectiveCamera()

  get aspect () :number { return this._perspectiveCamera.aspect }
  set aspect (aspect :number) {
    this._perspectiveCamera.aspect = aspect
    this._perspectiveCamera.updateProjectionMatrix()
  }

  get fieldOfView () :number { return this._perspectiveCamera.fov }
  set fieldOfView (fov :number) {
    this._perspectiveCamera.fov = fov
    this._perspectiveCamera.updateProjectionMatrix()
  }
}
registerComponentType("camera", ThreeCamera)
