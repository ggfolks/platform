import {Bounds, Ray, rect, vec2, vec3} from "../core/math"
import {Color} from "../core/color"
import {Value} from "../core/react"
import {Disposable} from "../core/util"
import {Component, Configurable, ConfigurableConfig, Hoverable, Transform} from "./game"

/** Top-level interface to render engine. */
export interface RenderEngine extends Disposable {

  /** The HTML canvas. */
  readonly domElement :HTMLElement

  /** The array of cameras currently active. */
  readonly activeCameras :Camera[]

  /** The renderer stats. */
  readonly stats :Value<string[]>

  /** The percentage of resources loaded (0 to 1). */
  readonly percentLoaded :Value<number>

  /** Preloads a model URL. */
  preload (url :string) :void

  /** Notes that we started loading a resource externally.  The URL isn't actually resolved here;
    * it's just used as an identifier.
    * @param url the URL of the resource being loaded. */
  noteLoading (url :string) :void

  /** Notes that we finished loading a resource externally.
    * @param url the URL of the resource that we finished loading. */
  noteFinished (url :string) :void

  /** Sets the onscreen bounds of the renderer. */
  setBounds (bounds :rect) :void

  /** Casts a ray into the scene, finding all intersections.
    * @param origin the origin of the ray in world space.
    * @param direction the direction of the ray in world space.
    * @param [minDistance=0] the minimum intersection distance.
    * @param [maxDistance=Infinity] the maximum intersection distance.
    * @param [layerMask=ALL_LAYERS_MASK] the mask that determines which layers to include.
    * @param [target] an array to populate; otherwise, a new one will be created.
    * @return the array of hit objects. */
  raycastAll (
    origin :vec3,
    direction :vec3,
    minDistance? :number,
    maxDistance? :number,
    layerMask? :number,
    target? :RaycastHit[],
  ) :RaycastHit[]

  /** Finds all objects whose bounds intersect the ones provided.
    * @param bounds the bounds to check against.
    * @param [layerMask=ALL_LAYERS_MASK] the mask that determines which layers to include.
    * @param [target] an array to populate; otherwise, a new one will be created.
    * @return the array of overlapping objects. */
  overlapBounds (bounds :Bounds, layerMask? :number, target? :Transform[]) :Transform[]

  /** Updates the hover states. */
  updateHovers () :void

  /** Renders a frame. */
  render () :void
}

/** Describes a single raycast intersection. */
export interface RaycastHit {

  /** The distance to the intersection. */
  distance :number

  /** The world space intersection point. */
  point :vec3

  /** The transform of the object that we hit. */
  transform :Transform

  /** The texture coordinates of the intersection point. */
  textureCoord? :vec2

  /** The index of the intersected triangle. */
  triangleIndex? :number
}

/** Renders the mesh specified by the `meshFilter`. */
export interface MeshRenderer extends Component, Hoverable {

  /** The first material assigned to the renderer. */
  material :Material

  /** The array of materials assigned to the renderer. */
  materials :Material[]

  /** The configuration of the first material. */
  materialConfig :ConfigurableConfig

  /** The configurations of all the materials. */
  materialConfigs :ConfigurableConfig[]

  /** The bounds of the mesh. */
  readonly bounds :Bounds
}

export type MaterialSide = "front" | "back" | "double"
export const MaterialSides = ["front", "back", "double"]

/** Represents a single material. */
export interface Material extends Configurable {

  /** Whether to treat the material as transparent. */
  transparent :boolean

  /** The alpha test threshold. */
  alphaTest :number

  /** The side to render. */
  side :MaterialSide

  /** The material opacity. */
  opacity :number
}

/** Represents a camera attached to a game object. */
export interface Camera extends Component, Hoverable {

  /** The camera's aspect ratio (width over height). */
  aspect :number

  /** The camera's vertical field of view in degrees. */
  fieldOfView :number

  /** Whether or not to use an orthographic projection. */
  orthographic :boolean

  /** The orthographic vertical half-size. */
  orthographicSize :number

  /** The distance to the near clip plane. */
  nearClipPlane :number

  /** The distance to the far clip plane. */
  farClipPlane :number

  /** The mask that determines which layers to render. */
  cullingMask :number

  /** The mask that determines which layers to send events to. */
  eventMask :number

  /** Finds the direction in world space in which the camera is pointing.
    * @param [target] an optional vector to hold the result.
    * @return the direction in world space. */
  getDirection (target? :vec3) :vec3

  /** Converts a point in screen coordinates (0,0 at upper left, width-1,height-1 at lower right)
    * to a ray in world space for this camera.
    * @param coords the coordinates to convert.
    * @param [target] an optional ray to hold the result.
    * @return the ray in world space. */
  screenPointToRay (coords :vec2, target? :Ray) :Ray

  /** Converts a point in viewport coordinates (0,0 at lower left, 1,1 at upper right) to a
    * ray in world space for this camera.
    * @param coords the coordinates to convert.
    * @param [target] an optional ray to hold the result.
    * @return the ray in world space. */
  viewportPointToRay (coords :vec2, target?: Ray) :Ray

  /** Converts a point in world space to screen coordinates.
    * @param coords the coordinates to convert.
    * @param [target] an optional vector to hold the result.
    * @return the location in screen coordinates. */
  worldToScreenPoint (coords :vec3, target? :vec3) :vec3

  /** Converts a point in world space to viewport coordinates.
    * @param coords the coordinates to convert.
    * @param [target] an optional vector to hold the result.
    * @return the location in viewport coordinates. */
  worldToViewportPoint (coords :vec3, target? :vec3) :vec3
}

/** The available light types. */
export type LightType = "ambient" | "directional"
export const LightTypes = ["ambient", "directional"]

/** Represents a light attached to a game object. */
export interface Light extends Component {

  /** The light type. */
  lightType :LightType

  /** The light color. */
  color :Color
}

/** Represents a (GLTF) model loaded from a URL. */
export interface Model extends Component, Hoverable {

  /** The URL of the model to load. */
  url? :string

  /** The bounds of the model. */
  readonly bounds :Bounds
}
