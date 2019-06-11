import { Data, dataEquals, refEquals } from "./data"

export type Remover = () => void
export const NoopRemover :Remover = () => true

// TypeScript infers literal types for type parameters with bounds, so when we bound our reactive
// value types by Data, that causes calls like `mutable("")` to yield types like `Mutable<"">`
// instead of `Mutable<string>` which is not desirable. This helper type allows us to force the type
// checker to widen the types in places where we need it.
type Widen<T> =
  T extends string  ? string :
  T extends number  ? number :
  T extends boolean ? boolean : T;

/** An equality function, used to test whether values have actually changed during reactive value
  * propagation. */
export type Eq<T> = (a:T,b:T) => boolean

//
// Listener plumbing

function addListener<T> (listeners :T[], listener :T) :Remover {
  listeners.push(listener)
  return () => {
    let ii = listeners.indexOf(listener)
    if (ii >= 0) {
      listeners.splice(ii, 1)
    }
    return (listeners.length == 0)
  }
}

export class MultiError extends Error {
  constructor (readonly errors :Error[]) {
    super(`${errors.length} errors`)
  }
}

export type ValueFn<T> = (value :T) => any

function dispatchValue<T> (listeners :Array<ValueFn<T>>, value :T) {
  let errors
  for (let listener of listeners.slice()) {
    try {
      listener(value)
    } catch (error) {
      if (!errors) errors = []
      errors.push(error)
    }
  }
  if (errors) {
    if (errors.length === 1) throw errors[0]
    else throw new MultiError(errors)
  }
}

export type ChangeFn<T> = (value :T, oldValue :T) => any

function dispatchChange<T> (listeners :Array<ChangeFn<T>>, value :T, oldValue :T) {
  let errors
  for (let listener of listeners.slice()) {
    try {
      listener(value, oldValue)
    } catch (error) {
      if (!errors) {
        errors = []
      }
      errors.push(error)
    }
  }
  if (errors) {
    if (errors.length === 1) {
      throw errors[0]
    } else {
      throw new MultiError(errors)
    }
  }
}

//
// Reactive listenable

export interface Source<T> {
  onValue (fn :ValueFn<T>) :Remover
  onNextValue (fn :ValueFn<T>) :Remover
  map<F extends Data> (fn :(v:T) => F) :Source<F>
}

export function when<T> (value :Source<T>, pred :(v:T) => boolean, fn :ValueFn<T>) :Remover {
  return value.onValue(v => { if (pred(v)) fn(v) })
}

export function whenDefined<T> (value :Source<T|undefined>, fn :ValueFn<T>) :Remover {
  return value.onValue(v => { if (v !== undefined) fn(v) })
}

export function once<T> (value :Source<T>, pred :(v:T) => boolean, fn :ValueFn<T>) :Remover {
  let remover :Remover
  return (remover = value.onValue(v => { if (pred(v)) { remover() ; fn(v) } }))
}

export function onceDefined<T> (value :Source<T|undefined>, fn :ValueFn<T>) :Remover {
  let remover :Remover
  return (remover = value.onValue(v => { if (v !== undefined) { remover() ; fn(v) } }))
}

//
// Reactive streams

export class Stream<T> implements Source<T> {

  constructor (readonly onValue :(fn :ValueFn<T>) => Remover) {}

  onNextValue (fn :ValueFn<T>) :Remover {
    let remover :Remover
    const once = (value :T) => {
      remover()
      fn(value)
    }
    return (remover = this.onValue(once))
  }

  map<F> (fn :(v:T) => F) :Stream<F> {
    return deriveStream(dispatch => this.onValue(value => dispatch(fn(value))))
  }

  filter (pred :(v:T) => Boolean) :Stream<T> {
    return deriveStream(dispatch => this.onValue(value => pred(value) && dispatch(value)))
  }

  toValue (start :T, eq :Eq<T>) :Value<T> {
    const stream = this
    class StreamValue extends DerivedValue<T> {
      private _current = start
      get current () :T { return this._current }
      _connectToSource () {
        return stream.onValue(value => {
          const previous = this._current
          if (!this.eq(previous, value)) {
            this._current = value
            this._dispatchValue(value, previous)
          }
        })
      }
    }
    return new StreamValue(eq)
  }
}

export function valueFromStream<T extends Data> (stream :Stream<T>, start :T) :Value<T> {
  return stream.toValue(start, dataEquals)
}

export function valueFromStreamRef<T> (stream :Stream<T>, start :T) :Value<T> {
  return stream.toValue(start, refEquals)
}

/**
 * Merges `sources` streams into a single stream that emits a value whenever any of the underlying
 * streams emit a value.
 */
export function merge<E> (...sources :Array<Stream<E>>) :Stream<E> {
  return deriveStream(dispatch => {
    let removers :Remover[] = sources.map(s => s.onValue(dispatch))
    return () => removers.forEach(r => r())
  })
}

export class Emitter<T> extends Stream<T> {
  private _listeners :Array<ValueFn<T>> = []

  constructor () { super(lner => addListener(this._listeners, lner)) }

  emit (value :T) {
    dispatchValue(this._listeners, value)
  }
}

export function emitter<T> () :Emitter<T> {
  return new Emitter<T>()
}

function deriveStream<T> (connect :(dispatch :(v:T) => void) => Remover) :Stream<T> {
  const listeners :Array<(v :T) => any> = []
  let disconnect :Remover = NoopRemover
  const dispatch = (value :T) => { dispatchValue(listeners, value) }

  return new Stream(listener => {
    const needConnect = listeners.length === 0
    const remover = addListener(listeners, listener)
    if (needConnect) disconnect = connect(dispatch)
    return () => {
      remover()
      if (listeners.length == 0) {
        disconnect()
        disconnect = NoopRemover
      }
    }
  })
}

//
// Reactive values

export abstract class Value<T> implements Source<T> {

  constructor (readonly eq :Eq<T>) {}

  abstract get current () :T

  abstract onChange (fn :ChangeFn<T>) :Remover

  onChangeOnce (fn :ChangeFn<T>) :Remover {
    let remover :Remover
    return (remover = this.onChange((value, ovalue) => {
      remover()
      fn(value, ovalue)
    }))
  }

  onValue (fn :ValueFn<T>) :Remover {
    fn(this.current)
    return this.onChange(fn)
  }

  onNextValue (fn :ValueFn<T>) :Remover {
    return this.onChange(fn)
  }

  map<U extends Data> (fn :(v:T) => U) :Value<U> {
    return new MappedValue(this, fn, dataEquals)
  }
  mapRef<U> (fn :(v:T) => U) :Value<U> {
    return new MappedValue(this, fn, refEquals)
  }
  mapEq<U> (fn :(v:T) => U, eq :Eq<U>) :Value<U> {
    return new MappedValue(this, fn, eq)
  }

  switchMap<R> (fn :(v:T) => Value<R>) :Value<R> {
    const source = this
    let savedSourceValue = source.current
    let mappedValue = fn(savedSourceValue)
    let latest = mappedValue.current
    function onSourceValue (value :T) :R {
      savedSourceValue = value
      mappedValue = fn(value)
      return latest = mappedValue.current
    }

    class SwitchMappedValue extends DerivedValue<R> {
      get current () :R {
        // rather than recreate a mapped reactive value every time our value is requested,
        // we cache the source value from which we most recently created our mapped value
        // if it has not changed, we reuse the mapped value; this assumes referential
        // transparency on the part of fn
        let sourceValue = source.current
        if (!source.eq(sourceValue, savedSourceValue)) {
          savedSourceValue = sourceValue
          mappedValue = fn(sourceValue)
        }
        return mappedValue.current
      }

      _connectToSource () {
        if (!source.eq(source.current, savedSourceValue)) onSourceValue(source.current)
        const dispatcher = (value :R, ovalue :R) => {
          const previous = latest
          latest = value
          this._dispatchValue(value, previous)
        }
        let disconnect = mappedValue.onChange(dispatcher)
        let unlisten = source.onChange((value, ovalue) => {
          disconnect()
          let previous = latest, current = onSourceValue(value)
          disconnect = mappedValue.onChange(dispatcher)
          if (!mappedValue.eq(current, previous)) {
            this._dispatchValue(current, previous)
          }
        })
        return () => {
          disconnect()
          return unlisten()
        }
      }
    }
    return new SwitchMappedValue(refEquals)
  }

  toStream () :Stream<T> {
    return new Stream<T>(fn => this.onChange(fn))
  }

  toPromise (pred :(value :T) => boolean) :Promise<T> {
    let current = this.current
    if (pred(current)) {
      return Promise.resolve(current)
    }
    return new Promise((resolve, reject) => {
      let remover = this.onChange(value => {
        if (pred(value)) {
          remover()
          resolve(value)
        }
      })
    })
  }
}

abstract class DerivedValue<T> extends Value<T> {
  private _listeners :Array<ChangeFn<T>> = []
  private _disconnect = NoopRemover

  abstract _connectToSource () :Remover

  _dispatchValue (current :T, previous :T) {
    dispatchChange(this._listeners, current, previous)
  }

  onChange (listener :ChangeFn<T>) :Remover {
    const needConnect = this._listeners.length === 0
    const remover = addListener(this._listeners, listener)
    if (needConnect) this._disconnect = this._connectToSource()
    return () => {
      remover()
      if (this._listeners.length > 0) {
        this._disconnect()
        this._disconnect = NoopRemover
      }
    }
  }

  protected get isConnected () :boolean { return this._disconnect !== NoopRemover }
}

class ConstantValue<T> extends Value<T> {
  constructor (readonly current :T, eq :Eq<T>) { super(eq) }
  onChange (fn :ChangeFn<T>) :Remover { return NoopRemover }
}

export function constant<T extends Data> (value :T) :Value<Widen<T>> {
  return new ConstantValue(value as Widen<T>, dataEquals)
}

export function constantOpt<T extends Data> (value :T|undefined) :Value<Widen<T|undefined>> {
  return new ConstantValue(value as Widen<T|undefined>, dataEquals)
}

export function constantRef<T> (value :T) :Value<T> {
  return new ConstantValue(value, refEquals)
}

export function constantEq<T> (value :T, eq :Eq<T>) :Value<T> {
  return new ConstantValue(value, eq)
}

class JoinedValue extends DerivedValue<any[]> {
  constructor (readonly sources :Value<any>[]) {
    super((as, bs) => {
      for (let ii = 0, ll = sources.length; ii < ll; ii += 1) {
        if (!sources[ii].eq(as[ii], bs[ii])) return false
      }
      return true
    })
  }

  get current () { return this.sources.map(source => source.current) }

  _connectToSource () :Remover {
    const prev = this.current
    const curr = this.current
    const removers = this.sources.map((source, idx) => source.onChange((val, oval) => {
      prev[idx] = oval
      curr[idx] = val
      this._dispatchValue(curr, prev)
    }))
    return () => removers.forEach(r => r())
  }
}

export function join<A> (...sources :Array<Value<A>>) :Value<A[]> {
  return new JoinedValue(sources)
}

export function join2<A,B> (a :Value<A>, b :Value<B>) :Value<[A,B]> {
  return (new JoinedValue([a, b]) as any) as Value<[A,B]>
}

export function join3<A,B,C> (a :Value<A>, b :Value<B>, c :Value<C>) :Value<[A,B,C]> {
  return (new JoinedValue([a, b, c]) as any) as Value<[A,B,C]>
}

export abstract class Mutable<T> extends Value<T> {
  abstract update (newValue :T) :void
}

class LocalMutable<T> extends Mutable<T> {
  private _listeners :Array<ChangeFn<T>> = []

  constructor (private _value :T, eq :Eq<T>) { super(eq) }

  get current () :T { return this._value }

  update (newValue :T) {
    const oldValue = this._value
    if (!this.eq(oldValue, newValue)) {
      this._value = newValue
      dispatchChange(this._listeners, newValue, oldValue)
    }
  }

  onChange (listener :ChangeFn<T>) :Remover {
    return addListener(this._listeners, listener)
  }
}

export function mutable<T extends Data> (start :T) :Mutable<Widen<T>> {
  return new LocalMutable(start as Widen<T>, dataEquals)
}

export function mutableOpt<T extends Data> (start :T|undefined) :Mutable<Widen<T|undefined>> {
  return new LocalMutable(start as Widen<T|undefined>, dataEquals)
}

export function mutableRef<T> (start :T) :Mutable<T> {
  return new LocalMutable(start, refEquals)
}

export function mutableEq<T> (start :T, eq :Eq<T>) :Mutable<T> {
  return new LocalMutable(start, eq)
}

class MappedValue<S,T> extends DerivedValue<T> {
  private _latest! :T // initialized in _connectToSource; only used when connected

  get current () :T { return this.isConnected ? this._latest : this.fn(this.source.current) }

  constructor (readonly source :Value<S>, readonly fn :(value :S) => T, eq :Eq<T>) { super(eq) }

  _connectToSource () {
    this._latest = this.current
    return this.source.onChange((value :S, ovalue :S) => {
      let current = this.fn(value), previous = this._latest
      if (!this.eq(current, previous)) {
        this._latest = current
        this._dispatchValue(current, previous)
      }
    })
  }
}

// TODO: these are just interface definitions for now, to sketch out the API
// eventually they'll be abstract classes like RStream/RValue

//
// Reactive maps

export interface RMap<K,V> extends Iterable<[K,V]> {

  size :number
  has (key :K) :boolean
  get (key :K) :V|undefined

  set (key :K, value :V) :this
  delete (key :K) :boolean
  clear (): void

  // entries () :Iterator<[K,V]>
  keys () :Iterator<K>
  values () :Iterator<V>
  forEach (fn :(k:K, v:V) => void) :void
}

//
// Reactive sets

export interface RSet<E> extends Iterable<E> {

  size :number
  has (elem :E) :boolean

  add (elem :E) :this
  delete (elem :E) :boolean
  clear (): void

  // entries () :Iterator<[E,E]>
  // keys () :Iterator<E>
  // values () :Iterator<E>
  forEach (fn :(e:E) => void) :void
}

//
// Reactive lists

export interface RList<E> extends Iterable<E> {

  size :number
  length :number

  elemAt (index :number) :E
  append (elem :E) :void
  insert (elem :E, index :number) :void
  update (elem :E, index :number) :void
  delete (index :number) :void
  clear (): void

  forEach (fn :(e:E) => void) :void

  slice (start :number|void, length :number|void) :E[]
}
