import { dataEquals } from "./data"

export type Remover = () => boolean
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
// Reactive streams

class RStream<T> {

  static merge<E> (...sources :Array<RStream<E>>) :RStream<E> {
    return createStream(dispatch => {
      let removers :Remover[] = []
      for (let stream of sources) {
        removers.push(stream.onValue(dispatch))
      }
      return () => {
        let empty = true
        for (const remover of removers) empty = remover()
        return empty
      }
    })
  }

  constructor (readonly onValue :(fn :ValueFn<T>) => Remover) {}

  onNextValue (fn :ValueFn<T>) :Remover {
    let remover :Remover
    const once = (value :T) => {
      remover()
      fn(value)
    }
    return (remover = this.onValue(once))
  }

  map<F> (fn :(v:T) => F) :RStream<F> {
    return createStream(dispatch => this.onValue(value => dispatch(fn(value))))
  }

  filter (pred :(v:T) => Boolean) :RStream<T> {
    return createStream(dispatch => this.onValue(value => pred(value) && dispatch(value)))
  }

  toValue (start :T) :RValueView<T> {
    const stream = this
    let current = start
    class StreamValue extends RValueView<T> {
      get current () :T { return current }
      onChange (listener :ChangeFn<T>) {
        return stream.onValue(value => {
          let previous = current
          if (!dataEquals(value, previous)) {
            current = value
            listener(value, previous)
          }
        })
      }
    }
    return new StreamValue()
  }
}

function createStream<T> (connect :(dispatch :(value :T) => void) => Remover) :RStream<T> {
  const listeners :Array<(v :T) => any> = []
  let disconnect :Remover = NoopRemover
  const dispatch = (value :T) => { dispatchValue(listeners, value) }

  return new RStream(listener => {
    const needConnect = listeners.length === 0
    const remover = addListener(listeners, listener)
    if (needConnect) disconnect = connect(dispatch)
    return () => {
      if (!remover()) return false
      disconnect()
      disconnect = NoopRemover
      return true
    }
  })
}

//
// Reactive values

export abstract class RValueView<T> {

  static whenDefined<T> (value :RValueView<T|undefined>, fn :ValueFn<T>) :Remover {
    // TODO
    return NoopRemover
  }

  static onceDefined<T> (value :RValueView<T|undefined>, fn :ValueFn<T>) :Remover {
    // TODO
    return NoopRemover
  }

  abstract get current () :T

  map<U> (fn :(v:T) => U) :RValueView<U> {
    return new MappedValue(this, fn)
  }

  filter (pred :(v:T) => Boolean) :RValueView<T|undefined> {
    return new MappedValue(this, value => pred(value) ? value : undefined)
  }

  switchMap<R> (fn :(v:T) => RValueView<R>) :RValueView<R> {
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
        // we cache the source value from which we most recently created our mapped value;
        // if it has not changed, we reuse the mapped value; this assumes referential
        // transparency on the part of fn
        let sourceValue = source.current
        if (sourceValue !== savedSourceValue) {
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
          if (current !== previous) {
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

  toStream () :RStream<T> {
    return new RStream<T>(fn => this.onChange(fn))
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

  onValue (fn :ValueFn<T>) :Remover {
    fn(this.current)
    return this.onChange(fn)
  }

  onNextValue (fn :ValueFn<T>) :Remover {
    return this.onChangeOnce(fn)
  }

  abstract onChange (fn :ChangeFn<T>) :Remover

  onChangeOnce (fn :ChangeFn<T>) :Remover {
    let remover :Remover
    const once = (value :T, ovalue :T) => {
      remover()
      fn(value, ovalue)
    }
    return (remover = this.onChange(once))
  }

  onceEqual (targetValue :T, onEqual :(value :T) => any) :Remover {
    let current = this.current
    if (dataEquals(current, targetValue)) {
      onEqual(current)
      return NoopRemover
    }
    let remover :Remover
    const once = (value :T) => {
      if (dataEquals(value, targetValue)) {
        remover()
        onEqual(value)
      }
    }
    return (remover = this.onChange(once))
  }
}

export abstract class RValue<T> extends RValueView<T> {

  static create<T> (start :T) :RValue<T> {
    return new LocalValue(start)
  }

  abstract update (newValue :T) :void
}

abstract class DerivedValue<T> extends RValueView<T> {
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
      if (!remover()) return false
      this._disconnect()
      this._disconnect = NoopRemover
      return true
    }
  }
}

class MappedValue<S,T> extends DerivedValue<T> {
  private _mapped :T

  mapper = (value :S, ovalue :S) => {
    let current = this.fn(value), previous = this._mapped
    if (current !== previous) {
      this._mapped = current
      this._dispatchValue(current, previous)
    }
  }

  get current () :T { return this._mapped }

  constructor (readonly source :RValueView<S>, readonly fn :(value :S) => T) {
    super()
    this._mapped = fn(source.current)
  }

  _connectToSource () {
    this._mapped = this.fn(this.source.current)
    return this.source.onChange(this.mapper)
  }
}

class LocalValue<T> extends RValue<T> {
  private _listeners :Array<ChangeFn<T>> = []

  constructor (private _value :T) {
    super()
  }

  get current () :T {
    return this._value
  }

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

// TODO: these are just interface definitions for now, to sketch out the API;
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
