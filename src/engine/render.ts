import {Disposable} from "../core/util"
import {Component} from "./game"

/** Top-level interface to render engine. */
export interface RenderEngine extends Disposable {

  /** Updates the render engine. Should be called once per frame. */
  update () :void
}

/** Renders the mesh specified by the `meshFilter`. */
export interface MeshRenderer extends Component {
}

/** Represents a camera attached to a game object. */
export interface Camera extends Component {

  /** The camera's aspect ratio (width over height). */
  aspect :number

  /** The camera's vertical field of view in degrees. */
  fieldOfView :number
}
