import {Clock} from "../core/clock"
import {mat4, quat, vec3} from "../core/math"
import {Mutable, Value} from "../core/react"
import {RMap} from "../core/rcollect"
import {Disposable, PMap} from "../core/util"
import {InputNodeContext} from "../input/node"
import {UINodeContext} from "../ui/node"
import {GraphConfig} from "../graph/graph"
import {CategoryNode} from "../graph/node"
import {PropertyMeta, setEnumMeta} from "../graph/meta"
import {PhysicsEngine} from "./physics"
import {RenderEngine} from "./render"

/** Base type of the configurations of all configurable objects. */
export type ConfigurableConfig = PMap<any>

/** Base interface for objects that are configurable--that is, whose state can be captured in a
  * JavaScript object and that can be reconfigured with instances of same. */
export interface Configurable extends Disposable {

  /** Flags this object as configurable. */
  readonly isConfigurable :true

  /** The owning game engine. */
  readonly gameEngine :GameEngine

  /** The supertype of the configurable object. */
  readonly supertype :string

  /** The type of the configurable object. */
  readonly type :string

  /** The metadata for the object's viewable/editable properties. */
  readonly propertiesMeta :RMap<string, PropertyMeta>

  /** Initializes the object.  Called immediately after creation. */
  init () :void

  /** Returns a reactive view of the specified property.
    * @param name the name of the desired property.
    * @param [overrideDefault] if specified, a value that will override the default default.
    * @return the reactive value, which may or may not be writable. */
  getProperty<T> (name :string, overrideDefault? :any) :Value<T>|Mutable<T>

  /** Returns the config of this object as a a new object.
    * @param [omitType=false] if true, leave the type out of the config.
    * @return the newly created config. */
  createConfig (omitType? :boolean) :ConfigurableConfig

  /** Reconfigures this object.
    * @param type the type of the new object, or undefined for none.
    * @param config the configuration to apply, or null to "reconfigure" into null.
    * @return either this object, if the config is of the same type, or a new object with the
    * supplied config, or null.  If the object couldn't be reused, it will be disposed. */
  reconfigure (type :string|undefined, config :ConfigurableConfig|null) :Configurable|null
}

/** The available primitive types. */
export type PrimitiveType = "sphere" | "cylinder" | "cube" | "quad" | "cone" | "torus"
export const PrimitiveTypes = ["sphere", "cylinder", "cube", "quad", "cone", "torus"]

/** The type used to configure game objects. */
export interface GameObjectConfig {
  name? :string
  order? :number
  [extra :string] :any
}

/** The type used to configure spaces. */
export type SpaceConfig = PMap<GameObjectConfig>

/** Context container. */
export interface GameContext extends UINodeContext, InputNodeContext {

  /** Provides graphs with a reference to the owning component. */
  graphComponent? :Graph
}

/** The id of the default page. */
export const DEFAULT_PAGE = "default"

/** The default object layer flag. */
export const DEFAULT_LAYER_FLAG = (1 << 0)

/** A mask that matches all layers. */
export const ALL_LAYERS_MASK = ~0

/** A mask that matches all hide flags. */
export const ALL_HIDE_FLAGS_MASK = ~0

/** Top-level interface to game engine. */
export interface GameEngine extends Disposable {

  /** The context object. */
  readonly ctx :GameContext

  /** The active render engine. */
  readonly renderEngine :RenderEngine

  /** The active physics engine. */
  readonly physicsEngine :PhysicsEngine

  /** The keys of the pages in sorted order. */
  readonly pages :Value<string[]>

  /** The currently active page. */
  readonly activePage :Mutable<string>

  /** The ids of the roots of the current page in sorted order. */
  readonly rootIds :Value<string[]>

  /** All game objects, mapped by id. */
  readonly gameObjects :RMap<string, GameObject>

  /** Creates the configuration of a reconfigurable reference as a new object.
    * @param configurable the configurable object, or null for none.
    * @param [omitType=false] if true, leave the type out of the config.
    * @return the configuration of the object, or null for none. */
  createConfigurableConfig (
    configurable :Configurable|null,
    omitType? :boolean,
  ) :ConfigurableConfig|null

  /** Reconfigures a configurable reference.
    * @param supertype the configurable supertype (e.g., "component").
    * @param configurable the configurable object, or null for none.
    * @param type the type of the new object, or undefined for none.
    * @param config the new configuration, or null for none.
    * @param constructorArgs additional arguments to pass to the constructor.
    * @return either the reference passed in (if reconfigured) or a new object (if recreated) or
    * null.  If the object couldn't be reused, it will be disposed. */
  reconfigureConfigurable (
    supertype :string,
    configurable :Configurable|null,
    type :string|undefined,
    config :ConfigurableConfig|null,
    ...constructorArgs :any[]
  ) :Configurable|null

  /** Returns the type root for the identified supertype.
    * @param supertype the configurable supertype (e.g., "component").
    * @return the root of the type tree. */
  getConfigurableTypeRoot (supertype :string) :CategoryNode

  /** Creates a page object.
    * @param [name] the name of the page. */
  createPage (name? :string) :GameObject

  /** Creates and returns a new game object containing a primitive (on the current page).
    * @param type the type of primitive desired.
    * @param [config] additional configuration to merge in. */
  createPrimitive (type :PrimitiveType, config? :GameObjectConfig) :GameObject

  /** Loads the space at the specified URL, replacing all current game objects.
    * @param url the url of the space to load.
    * @param [layerMask=ALL_LAYERS_MASK] the layer mask to use to determine which objects to
    * replace.
    * @param [cache=true] whether or not to load the space through the cache.
    * @return a promise that will resolve when the space is loaded.  Note that this doesn't mean
    * all resources (models, etc.) referenced by the space have loaded. */
  loadSpace (url :string, layerMask? :number, cache? :boolean) :Promise<void>

  /** Creates a set of game objects on the current page.
    * @param configs the map from name to config. */
  createGameObjects (configs :SpaceConfig) :void

  /** Creates and returns a new (empty) game object on the current page.
    * @param [name] the name of the object.
    * @param [config] the configuration of the object's components. */
  createGameObject (name? :string, config? :GameObjectConfig) :GameObject

  /** Disposes of all game objects matching the given layers.
    *  @param [layerMask=ALL_LAYERS_MASK] the layer mask to use to filter objects. */
  disposeGameObjects (layerMask? :number) :void

  /** Returns the configuration of the entire space as a new object.
    * @param [layerMask=ALL_LAYERS_MASK] the layer mask to use to filter objects in.
    * @param [hideMask=ALL_HIDE_FLAGS_MASK] the hide mask to use to filter objects out. */
  createConfig (layerMask? :number, hideMask? :number) :SpaceConfig

  /** Updates the game state. */
  update (clock :Clock) :void
}

/** Time is just a global reference. */
export const Time = {deltaTime: 0}

// https://stackoverflow.com/questions/36886082/abstract-constructor-type-in-typescript
export type ComponentConstructor<T extends Component> = Function & { prototype: T }

/** Represents an object in the game hierarchy. */
export interface GameObject extends Disposable {

  /** The game object's unique id. */
  readonly id :string

  /** The game object's layer flags. */
  layerFlags :number

  /** The game object's hide flags. */
  hideFlags :number

  /** The game object's name. */
  name :string

  /** The object's sort order. */
  order :number

  /** True if this object itself is flagged as active. */
  activeSelf :boolean

  /**  True if this object and all of its ancestors are active. */
  activeInHierarchy :boolean

  /** The game object's transform component. */
  readonly transform :Transform

  /** The types of the components of the object in sorted order. */
  readonly componentTypes :Value<string[]>

  /** A reactive view of the component map. */
  readonly components :RMap<string, Component>

  /** Adds a set of components to the game object.
    * @param config the object mapping component types to configurations. */
  addComponents (config :PMap<ConfigurableConfig>) :void

  /** Adds a component to the game object.  Once the component is added, it will be accessible as
    * `gameObject.componentType`.
    * @param type the type of component to add.
    * @param [config] optional configuration for the component.
    * @return the newly created component. */
  addComponent<T extends Component> (type :string, config? :ConfigurableConfig) :T

  /** Gets a typed reference to a component, throwing an exception if not present.
    * @param type the type of component desired.
    * @return the component reference. */
  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T

  /** Gets a typed reference to a component.
    * @param type the type of component desired.
    * @return the component reference. */
  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined

  /** Gets a typed reference to a component, searching all ancestors in sequence.
    * @param type the type of component desired.
    * @return the component reference. */
  getComponentInParent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined

  /** Sends a message to all components on the game object.
    * @param message the name of the message to send.
    * @param args the arguments to pass along with the message. */
  sendMessage (message :string, ...args :any[]) :void

  /** Sends a message to this game object and all of its descendents.
    * @param message the name of the message to send.
    * @param args the arguments to pass along with the message. */
  broadcastMessage (message :string, ...args: any[]) :void

  /** Returns a reactive view of the specified property.
    * @param name the name of the desired property.
    * @param [overrideDefault] if specified, a value that will override the default default.
    * @return the reactive value, which may or may not be writable. */
  getProperty<T> (name :string, overrideDefault? :any) :Value<T>|Mutable<T>

  /** Returns the configuration of this game object as a new object.
    * @param [hideMask=ALL_HIDE_FLAGS_MASK] the hide mask to use to filter components out. */
  createConfig (hideMask? :number) :GameObjectConfig

  /** Anything else is an untyped component. */
  readonly [type :string] :any
}

/** Base class for object components. */
export interface Component extends Configurable {

  /** The game object to which this component is attached. */
  readonly gameObject :GameObject

  /** The game object transform. */
  readonly transform :Transform

  /** The component's type aliases, under which it is also registered. */
  readonly aliases :string[]

  /** Whether or not the component is removable (transforms, for instance, are not). */
  readonly removable :boolean

  /** The component's hide flags. */
  hideFlags :number

  /** The sort order of the component. */
  order :number

  /** Gets a typed reference to a component, throwing an exception if not present.
    * @param type the type of component desired.
    * @return the component reference. */
  requireComponent<T extends Component> (type :string|ComponentConstructor<T>) :T

  /** Gets a typed reference to a component.
    * @param type the type of component desired.
    * @return the component reference. */
  getComponent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined

  /** Gets a typed reference to a component, searching all ancestors in sequence.
    * @param type the type of component desired.
    * @return the component reference. */
  getComponentInParent<T extends Component> (type :string|ComponentConstructor<T>) :T|undefined

  /** Sends a message to all components on the game object.
    * @param message the name of the message to send.
    * @param args the arguments to pass along with the message. */
  sendMessage (message :string, ...args :any[]) :void

  /** Sends a message to this game object and all of its descendents.
    * @param message the name of the message to send.
    * @param args the arguments to pass along with the message. */
  broadcastMessage (message :string, ...args: any[]) :void

  /** Starts a coroutine on this component.
    * @param fnOrGenerator the coroutine to start.
    * @return the coroutine object. */
  startCoroutine (fnOrGenerator :(() => Generator<void>)|Generator<void>) :Coroutine

  /** Stops all coroutines on this component. */
  stopAllCoroutines () :void

  /** Optional wake function. */
  readonly awake? :() => void

  /** Optional function to call on activation. */
  readonly onEnable? :() => void

  /** Optional function to call on deactivation. */
  readonly onDisable? :() => void

  /** Optional update function. */
  readonly update? :(clock :Clock) => void

  /** Optional function to call if the transform changed. */
  readonly onTransformChanged? :() => void

  /** Optional function to call if any ancestor of the transform changed. */
  readonly onTransformParentChanged? :() => void

  /** Optional function to call when we start hovering over the object. */
  readonly onPointerEnter? :(identifier :number, hover :Hover) => void

  /** Optional function to call when we stop hovering over the object. */
  readonly onPointerExit? :(identifier :number) => void

  /** Optional function to call each frame we hover over the object. */
  readonly onPointerOver? :(identifier :number, hover :Hover) => void

  /** Optional function to call when we press on the object. */
  readonly onPointerDown? :(identifier :number, hover :Hover) => void

  /** Optional function to call when we release from the object. */
  readonly onPointerUp? :(identifier :number) => void

  /** Optional function to call each frame we're pressing on the object. */
  readonly onPointerDrag? :(identifier :number, hover :Hover) => void
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

  /** The parent id, if any (used for configuration). */
  parentId? :string

  /** Sets the transform's parent.
    * @param parent the new parent, if any.
    * @param [worldPositionStays=true] whether or not to retain the world position. */
  setParent (parent :Transform|undefined, worldPositionStays? :boolean) :void

  /** The ids of the transform children in sorted order. */
  readonly childIds :Value<string[]>

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

  /** The transform's right direction (local X+) in world space. */
  readonly right :vec3

  /** The transform's up direction (local Y+) in world space. */
  readonly up :vec3

  /** The transform's forward direction (local Z+) in world space. */
  readonly forward :vec3

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

/** Represents a top-level page. */
export interface Page extends Component {

  /** Checks/sets whether or not this page is active. */
  active :boolean
}

/** Contains a mesh. */
export interface MeshFilter extends Component {

  /** The mesh to render. */
  mesh :Mesh|null

  /** The configuration of the mesh. */
  meshConfig :ConfigurableConfig|null
}

/** A piece of geometry. */
export interface Mesh extends Configurable {}

/** A spherical mesh. */
export interface Sphere extends Mesh {}

/** A cylindrical mesh. */
export interface Cylinder extends Mesh {}

/** A cubic mesh. */
export interface Cube extends Mesh {}

/** A quad mesh. */
export interface Quad extends Mesh {}

/** A cone mesh. */
export interface Cone extends Mesh {}

/** A torus mesh. */
export interface Torus extends Mesh {}

/** Manages the object's behavior graph. */
export interface Graph extends Component {

  /** The graph configuration. */
  graphConfig :GraphConfig
}
