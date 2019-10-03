import {quat, vec3} from "../core/math"
import {Disposable} from "../core/util"

/** The available primitive types. */
export type PrimitiveType = "sphere" | "cylinder" | "cube" | "quad"

/** Top-level interface to scene graph engine. */
export interface Engine {

  /** Creates and returns a new (empty) game object.
    * @param [name] the name of the object. */
  createGameObject (name? :string) :GameObject

  /** Creates and returns a new game object containing a primitive.
    * @param type the type of primitive desired. */
  createPrimitive (type :PrimitiveType) :GameObject
}

/** The available component types. */
export type ComponentType = "transform" | "camera" | "light" | "model" | "animation"

/** Represents an object in the game hierarchy. */
export interface GameObject extends Disposable {

  /** The game object's name. */
  readonly name :string

  /** The game object's transform component. */
  readonly transform :Transform

  /** Adds a component to the game object.
    * @param type the type of component to add.
    * @return the newly created component. */
  addComponent (type :ComponentType) :Component

  /** Retrieves the component with the given type from the game object, if present.
    * @param type the type of component to fetch.
    * @return the component of the requested type, if any. */
  getComponent (type :ComponentType) :Component|undefined
}

/** Base class for components. */
export interface Component extends Disposable {
}

/** Represents a game object transform. */
export interface Transform extends Component {

  /** The transform's parent, if any. Setting the parent does not change the world position. */
  parent? :Transform

  /** Sets the transform's parent.
    * @param parent the new parent, if any.
    * @param [worldPositionStays=true] whether or not to retain the world position. */
  setParent (parent :Transform|undefined, worldPositionStays? :boolean) :void

  /** The transform's position relative to its parent. */
  localPosition :vec3

  /** The transform's rotation relative to its parent. */
  localRotation :quat

  /** The transform's scale relative to its parent. */
  localScale :vec3

  /** The transform's position in world space. */
  position :vec3

  /** The transform's rotation in world space. */
  rotation :quat

  /** The transform's scale in world space (approximate). */
  readonly lossyScale :vec3
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

  /** The light color. */
  color :vec3
}

/** Represents a (GLTF) model attached to a game object. */
export interface Model extends Component {

  /** The URL of the model to load. */
  url :string
}

/** Represents a set of (GLTF) animations attached to a game object. */
export interface Animation extends Component {

  /** Adds an animation clip.
    * @param url the URL of the clip to add.
    * @param name the name to assign to the animation. */
  addClip (url :string, name :string) :void

  /** Plays an animation.
    * @param [name] the name of the animation to play, if not the default. */
  play (name? :string) :void
}
