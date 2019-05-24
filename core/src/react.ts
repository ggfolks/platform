import { dataEquals } from "./data"

export type Remover = () => void
export const NoopRemover :Remover = () => true

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

export type ValueFn<T> = (value :T)=> any

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
  map<F> (fn :(v:T) => F) :Source<F>
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

  toValue (start :T) :Value<T> {
    const stream = this
    class StreamValue extends DerivedValue<T> {
      private _current = start
      get current () :T { return this._current }
      _connectToSource () {
        return stream.onValue(value => {
          const previous = this._current
          if (!dataEquals(previous, value)) {
            this._current = value
            this._dispatchValue(value, previous)
          }
        })
      }
    }
    return new StreamValue()
  }
}

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

function deriveStream<T> (connect :(dispatch :(value :T) => void) => Remover) :Stream<T> {
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

  map<U> (fn :(v:T) => U) :Value<U> {
    return new MappedValue(this, fn)
  }

  switchMap<R> (fn :(v:T) => Value<R>) :Value<R> {
    const source = this
    let savedSourceValue = source.current
    let mappedValue = fn(savedSourceValue)
    let latest = mappedValue.current
    function onValue (value :T) :R {
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
        if (!dataEquals(sourceValue, savedSourceValue)) {
          savedSourceValue = sourceValue
          mappedValue = fn(sourceValue)
        }
        return mappedValue.current
      }

      _connectToSource () {
        onValue(source.current)
        const dispatcher = (value :R, ovalue :R) => {
          const previous = latest
          latest = value
          this._dispatchValue(value, previous)
        }
        let disconnect = mappedValue.onChange(dispatcher)
        let unlisten = source.onChange((value, ovalue) => {
          disconnect()
          let previous = latest, current = onValue(value)
          disconnect = mappedValue.onChange(dispatcher)
          if (!dataEquals(current, previous)) {
            this._dispatchValue(current, previous)
          }
        })
        return () => {
          disconnect()
          return unlisten()
        }
      }
    }
    return new SwitchMappedValue()
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
}

class ConstantValue<T> extends Value<T> {
  constructor (readonly current :T) { super() }
  onChange (fn :ChangeFn<T>) :Remover { return NoopRemover }
}

export function constant<T> (value :T) :Value<T> {
  return new ConstantValue(value)
}

class JoinedValue extends DerivedValue<any[]> {
  constructor (readonly sources :Value<any>[]) { super() }

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

export function join (...sources :Array<Value<any>>) :Value<any[]> {
  return new JoinedValue(sources)
}

export function join2<A,B>(a :Value<A>, b :Value<B>) :Value<[A,B]> {
  return join(a, b) as Value<[A,B]>
}

export function join3<A,B,C>(a :Value<A>, b :Value<B>, c :Value<C>) :Value<[A,B,C]> {
  return join(a, b, c) as Value<[A,B,C]>
}

export abstract class Mutable<T> extends Value<T> {
  abstract update (newValue :T) :void
}

class LocalMutable<T> extends Mutable<T> {
  private _listeners :Array<ChangeFn<T>> = []

  constructor (private _value :T) { super() }

  get current () :T { return this._value }

  update (newValue :T) {
    const oldValue = this._value
    if (!dataEquals(oldValue, newValue)) {
      this._value = newValue
      dispatchChange(this._listeners, newValue, oldValue)
    }
  }

  onChange (listener :ChangeFn<T>) :Remover {
    return addListener(this._listeners, listener)
  }
}

export function mutable<T> (start :T) :Mutable<T> {
  return new LocalMutable(start)
}

class MappedValue<S,T> extends DerivedValue<T> {
  private _prev :T

  // note: we cannot use this._prev here because that's only updated when we have listeners
  // we must report the correct 'mapped' value from our underlying source regardless
  get current () :T { return this.fn(this.source.current) }

  constructor (readonly source :Value<S>, readonly fn :(value :S) => T) {
    super()
    this._prev = fn(source.current)
  }

  _connectToSource () {
    this._prev = this.current
    return this.source.onChange((value :S, ovalue :S) => {
      let current = this.fn(value), previous = this._prev
      if (!dataEquals(current, previous)) {
        this._prev = current
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
