import {Component} from "./game"

/** Renders a mesh. */
export interface MeshRenderer extends Component {
}

/** Represents a camera attached to a game object. */
export interface Camera extends Component {

  /** The camera's aspect ratio (width over height). */
  aspect :number

  /** The camera's vertical field of view in degrees. */
  fieldOfView :number
}
