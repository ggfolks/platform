
/** An interface for things that maintain external resources and should be disposed when no longer
  * needed. */
export interface Disposable {

  /** Disposes the resources used by this instance. */
  dispose () :void
}
