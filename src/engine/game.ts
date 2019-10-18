import {Clock} from "../core/clock"
import {mat4, quat, vec3} from "../core/math"
import {Mutable, Value} from "../core/react"
import {RMap} from "../core/rcollect"
import {Disposable, PMap} from "../core/util"
import {InputNodeContext} from "../input/node"
import {UINodeContext} from "../ui/node"
import {GraphConfig} from "../graph/graph"
import {setEnumMeta} from "../graph/meta"
import {PhysicsEngine} from "./physics"
import {RenderEngine} from "./render"

/** The available primitive types. */
export type PrimitiveType = "sphere" | "cylinder" | "cube" | "quad"

/** The type used to configure components. */
export type ComponentConfig = PMap<any>

/** The type used to configure game objects. */
export type GameObjectConfig = PMap<ComponentConfig>

/** Context container. */
export interface GameContext extends UINodeContext, InputNodeContext {

  /** Provides graphs with a reference to the owning component. */
  graphComponent? :Graph
}

/** Top-level interface to game engine. */
export interface GameEngine extends Disposable {

  /** The context object. */
  readonly ctx :GameContext

  /** The active render engine. */
  readonly renderEngine :RenderEngine

  /** The active physics engine. */
  readonly physicsEngine :PhysicsEngine

  /** Creates and returns a new game object containing a primitive.
    * @param type the type of primitive desired.
    * @param [config] additional configuration to merge in. */
  createPrimitive (type :PrimitiveType, config? :GameObjectConfig) :GameObject

  /** Creates a set of game objects.
    * @param configs the map from name to config. */
  createGameObjects (configs :PMap<GameObjectConfig>) :void

  /** Creates and returns a new (empty) game object.
    * @param [name] the name of the object.
    * @param [config] the configuration of the object's components. */
  createGameObject (name? :string, config? :GameObjectConfig) :GameObject

  /** Updates the game state. */
  update (clock :Clock) :void
}

/** Time is just a global reference. */
export const Time = {deltaTime: 0}

// https://stackoverflow.com/questions/36886082/abstract-constructor-type-in-typescript
export type ComponentConstructor<T extends Component> = Function & { prototype: T }

/** Represents an object in the game hierarchy. */
export interface GameObject extends Disposable {

  /** The game object's name. */
  name :string

  /** The game object's transform component. */
  readonly transform :Transform

  /** A reactive view of the component map. */
  readonly components :RMap<string, Component>

  /** Adds a set of components to the game object.
    * @param config the object mapping component types to configurations. */
  addComponents (config :PMap<ComponentConfig>) :void

  /** Adds a component to the game object.  Once the component is added, it will be accessible as
    * `gameObject.componentType`.
    * @param type the type of component to add.
    * @param [config] optional configuration for the component.
    * @return the newly created component. */
  addComponent<T extends Component> (type :string, config? :ComponentConfig) :T

  /** Gets a typed reference to a component, throwing an exception if not present.
    * @param type the type of component desired.
    * @return the component reference. */
  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T

  /** Gets a typed reference to a component.
    * @param type the type of component desired.
    * @return the component reference. */
  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined

  /** Sends a message to all components on the game object.
    * @param message the name of the message to send.
    * @param args the arguments to pass along with the message. */
  sendMessage (message :string, ...args :any[]) :void

  /** Anything else is an untyped component. */
  readonly [type :string] :any
}

/** Base class for object components. */
export interface Component extends Disposable {

  /** The game object to which this component is attached. */
  readonly gameObject :GameObject

  /** The game object transform. */
  readonly transform :Transform

  /** The component type. */
  readonly type :string

  /** Gets a typed reference to a component, throwing an exception if not present.
    * @param type the type of component desired.
    * @return the component reference. */
  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T

  /** Gets a typed reference to a component.
    * @param type the type of component desired.
    * @return the component reference. */
  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined

  /** Sends a message to all components on the game object.
    * @param message the name of the message to send.
    * @param args the arguments to pass along with the message. */
  sendMessage (message :string, ...args :any[]) :void

  /** Starts a coroutine on this component.
    * @param fnOrGenerator the coroutine to start.
    * @return the coroutine object. */
  startCoroutine (fnOrGenerator :(() => Generator<void>)|Generator<void>) :Coroutine

  /** Returns a reactive view of the specified property.
    * @param name the name of the desired property.
    * @param [overrideDefault] if specified, a value that will override the default default.
    * @return the reactive value, which may or may not be writable. */
  getProperty<T> (name :string, overrideDefault? :any) :Value<T|undefined>|Mutable<T|undefined>

  /** Optional wake function. */
  readonly awake? :() => void

  /** Optional update function. */
  readonly update? :(clock :Clock) => void

  /** Optional function to call if the transform changed. */
  readonly onTransformChanged? :() => void

  /** Optional function to call each frame we hover over the object. */
  readonly onHover? :(identifier :number, hover :Hover) => void

  /** Optional function to call when we stop hovering over the object. */
  readonly onHoverEnd? :(identifier :number) => void
}

/** Describes a hover point. */
export interface Hover {

  /** The position of the hover point in world space. */
  readonly worldPosition :vec3

  /** The movement in world space since the last frame. */
  readonly worldMovement :vec3

  /** The position of the hover point in view space (relative to the camera). */
  readonly viewPosition :vec3

  /** The movement of the view point in view space. */
  readonly viewMovement :vec3

  /** Whether or not the point is pressed. */
  readonly pressed :boolean
}

/** Interface for hoverable components. */
export interface Hoverable extends Component {

  /** The map from pointer id to hover point. */
  readonly hovers :RMap<number, Hover>
}

/** Represents a coroutine running on a component. */
export interface Coroutine extends Disposable {}

/** The different types of coordinate frames available. */
export type CoordinateFrame = "world" | "local"
setEnumMeta("CoordinateFrame", ["world", "local"])

/** Represents a game object transform. */
export interface Transform extends Component {

  /** The transform's parent, if any. Setting the parent does not change the world position. */
  parent? :Transform

  /** Sets the transform's parent.
    * @param parent the new parent, if any.
    * @param [worldPositionStays=true] whether or not to retain the world position. */
  setParent (parent :Transform|undefined, worldPositionStays? :boolean) :void

  /** The number of children of the transform. */
  readonly childCount :number

  /** Retrieves a child by index.
    * @param index the index of the desired child.
    * @return the child at the index. */
  getChild (index :number) :Transform

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

  /** The matrix that transforms from local to world space. */
  readonly localToWorldMatrix :mat4

  /** The matrix that transforms from world to local space. */
  readonly worldToLocalMatrix :mat4

  /** Rotates by a set of Euler angles in local (default) or world space.
    * @param euler the angles by which to rotate, in degrees.
    * @param [frame] the coordinate frame in which to rotate (local by default). */
  rotate (euler :vec3, frame? :CoordinateFrame) :void

  /** Translates by a vector in local (default) or world space.
    * @param vector the amount by which to translate.
    * @param [frame] the coordinate frame in which to translate (local by default). */
  translate (vector :vec3, frame? :CoordinateFrame) :void

  /** Transforms a point from local to world space.
    * @param point the point to transform.
    * @param [target] an optional vector to hold the result.
    * @return the result point. */
  transformPoint (point :vec3, target? :vec3) :vec3

  /** Transforms a vector from local to world space.  Won't be affected by translation, will be
    * affected by scale.
    * @param vector the vector to transform.
    * @param [target] an optional vector to hold the result.
    * @return the result vector. */
  transformVector (vector :vec3, target? :vec3) :vec3

  /** Transforms a direction from local to world space.  Won't be affected by translation and will
    * be normalized after transform.
    * @param direction the direction to transform.
    * @param [target] an optional vector to hold the result.
    * @return the result direction. */
  transformDirection (direction :vec3, target? :vec3) :vec3
}

/** Contains a mesh. */
export interface MeshFilter extends Component {

  /** The mesh to render. */
  mesh? :Mesh
}

/** A piece of geometry. */
export interface Mesh extends Disposable {}

/** A spherical mesh. */
export interface Sphere extends Mesh {}

/** A cylindrical mesh. */
export interface Cylinder extends Mesh {}

/** A cubic mesh. */
export interface Cube extends Mesh {}

/** A quad mesh. */
export interface Quad extends Mesh {}

/** Represents a (GLTF) model loaded from a URL. */
export interface Model extends Component, Hoverable {

  /** The URL of the model to load. */
  url? :string
}

/** Represents a set of (GLTF) animations loaded from URLs. */
export interface Animation extends Component {

  /** The URL of the first animation, if any. */
  url? :string

  /** The URLs of the animations to load. */
  urls :string[]

  /** Whether or not to play the animation automatically on startup. */
  playAutomatically :boolean

  /** Plays an animation
    * @param [name] the name of the animation to play, if not the default. */
  play (name? :string) :void
}

/** Manages the object's behavior graph. */
export interface Graph extends Component {

  /** The graph configuration. */
  config :GraphConfig
}
