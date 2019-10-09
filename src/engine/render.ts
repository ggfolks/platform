import {Color} from "../core/color"
import {Disposable} from "../core/util"
import {Component} from "./game"

/** Top-level interface to render engine. */
export interface RenderEngine extends Disposable {

  /** Creates a new material.
    * @return the newly created material instance. */
  createMaterial () :Material

  /** Updates the render engine. Should be called once per frame. */
  update () :void
}

/** Renders the mesh specified by the `meshFilter`. */
export interface MeshRenderer extends Component {

  /** The first material assigned to the renderer. */
  material :Material

  /** The array of materials assigned to the renderer. */
  materials :Material[]
}

/** The available material types. */
export type MaterialType = "basic" | "standard"

/** Represents a single material. */
export interface Material extends Disposable {

  /** The material type. */
  type :MaterialType

  /** The material color. */
  color :Color
}

/** Represents a camera attached to a game object. */
export interface Camera extends Component {

  /** The camera's aspect ratio (width over height). */
  aspect :number

  /** The camera's vertical field of view in degrees. */
  fieldOfView :number
}

/** The available light types. */
export type LightType = "ambient" | "directional"

/** Represents a light attached to a game object. */
export interface Light extends Component {

  /** The light type. */
  lightType :LightType

  /** The light color. */
  color :Color
}
