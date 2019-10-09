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

/** Represents a single material. */
export interface Material extends Disposable {

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

/** Represents a light attached to a game object. */
export interface Light extends Component {
  
}
