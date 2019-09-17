import * as firebase from "firebase/app"
import "firebase/firestore"

type Firestore = firebase.firestore.Firestore
type DocRef = firebase.firestore.DocumentReference
type Timestamp = firebase.firestore.Timestamp
type Blob = firebase.firestore.Blob
const Timestamp = firebase.firestore.Timestamp
const FieldValue = firebase.firestore.FieldValue
const Blob = firebase.firestore.Blob

import {TextEncoder, TextDecoder} from "util"
import {Data, Record} from "../core/data"
import {UUID} from "../core/uuid"
import {Encoder, Decoder, SyncSet, SyncMap, ValueType, setTextCodec} from "../core/codec"
import {SyncMsg, SyncType} from "./protocol"
import {DObjectType, DMutable, Path} from "./data"
import {isPersist} from "./meta"
import {DataStore, Resolved} from "./server"

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

function pathToRef (db :Firestore, path :Path) :DocRef {
  if (path.length < 2 || path.length % 2 != 0) throw new Error(`Can't make ref for ${path}`)
  let ref = db.collection(path[0]).doc(path[1])
  let idx = 2
  while (idx < path.length) {
    ref = ref.collection(path[idx]).doc(path[idx+1])
    idx += 2
  }
  return ref
}

const encoder = new Encoder()

function dataToFirestore (value :Data) :Blob {
  encoder.addValue(value, "data")
  return Blob.fromUint8Array(encoder.finish()) // TODO: clone Uint8Array?
}

function dataFromFirestore (value :Blob) :Data {
  const decoder = new Decoder(value.toUint8Array())
  return decoder.getValue("data") as Data
}

function recordToFirestore (value :Record) :Blob {
  encoder.addValue(value, "record")
  return Blob.fromUint8Array(encoder.finish()) // TODO: clone Uint8Array?
}

function recordFromFirestore (value :Blob) :Record {
  const decoder = new Decoder(value.toUint8Array())
  return decoder.getValue("record") as Record
}

// TODO: there are various mismatches in the data model that we should at least warn about if we see
// them: arrays can't contain nested arrays, maps can only contain string keys, etc.

function valueToFirestore (value :any, vtype :ValueType) :any {
  switch (vtype) {
  case "undefined": return null
  case "boolean": return value as boolean
  case "int8":
  case "int16":
  case "int32":
  case "size8":
  case "size16":
  case "size32":
  case "float32":
  case "float64":
  case "number": return value as number
  case "string": return value as string
  case "timestamp": return Timestamp.fromMillis(value)
  case "uuid": return value as UUID // UUID is string in JS and Firestore
  case "data": return dataToFirestore(value)
  case "record": return recordToFirestore(value)
  }
}

function valueFromFirestore (value :any, vtype :ValueType) :any {
  switch (vtype) {
  case "undefined": return undefined
  case "boolean": return value as boolean
  case "int8":
  case "int16":
  case "int32":
  case "size8":
  case "size16":
  case "size32":
  case "float32":
  case "float64":
  case "number": return value as number
  case "string": return value as string
  case "timestamp": return (value as Timestamp).toMillis()
  case "uuid": return value as string // UUID is a string in JS and Firestore
  case "data": return dataFromFirestore(value)
  case "record": return recordFromFirestore(value)
  }
}

// TODO: do we want fromSync to be true in here?
function setFromFirestore<E> (elems :any[], etype :ValueType, into :SyncSet<E>) {
  const tmp = new Set<E>()
  for (const elem of elems) tmp.add(valueFromFirestore(elem, etype))
  for (const elem of into) if (!tmp.has(elem)) into.delete(elem, true)
  for (const elem of tmp) into.add(elem, true)
}

function mapFromFirestore<V> (data :any, vtype :ValueType, into :SyncMap<string,V>) {
  const keys = [], vals :V[] = []
  for (const key in data) {
    keys.push(key)
    vals.push(valueFromFirestore(data[key], vtype))
  }
  for (const key of into.keys()) if (!keys.includes(key)) into.delete(key, true)
  for (let ii = 0; ii < keys.length; ii += 1) into.set(keys[ii], vals[ii], true)
}

class FirebaseResolved extends Resolved {
  readonly ref :DocRef

  constructor (db :Firestore, store :DataStore, path :Path, otype :DObjectType<any>) {
    super(store, path, otype)
    this.ref = pathToRef(db, path)
  }

  resolveData () {
    const hasPersist = this.object.metas.some(isPersist)
    if (!hasPersist) this.resolvedData()
    else {
      const unsub = this.ref.onSnapshot(snap => {
        if (snap.exists) {
          for (const meta of this.object.metas) {
            const value = snap.get(meta.name)
            if (value === undefined) continue // TEMP: todo, handle undefined `value` props
            const prop = this.object[meta.name]
            switch (meta.type) {
            case "value": (prop as DMutable<any>).update(
                valueFromFirestore(value, meta.vtype), true) ; break
            case "set": setFromFirestore(value, meta.etype, (prop as SyncSet<any>)) ; break
            case "map": mapFromFirestore(value, meta.vtype, (prop as SyncMap<string,any>)) ; break
            default: break // nothing to sync for collection & queue props
            }
          }
        } else {
          this.ref.set({})
        }
        // mark the object as resolved once we get the first snapshot
        if (this.state.current === "resolving") this.resolvedData()
      })
      this.state.whenOnce(state => state === "disposed", _ => unsub())
    }
  }

  sendSync (sync :SyncMsg, persist :boolean) {
    super.sendSync(sync, persist)
    if (!persist) return
    const meta = this.object.metas[sync.idx]
    switch (sync.type) {
    case SyncType.VALSET:
      this.ref.set({[meta.name]: valueToFirestore(sync.value, sync.vtype)}, {merge: true})
      break
    case SyncType.SETADD:
      const addedValue = valueToFirestore(sync.elem, sync.etype)
      this.ref.update({[meta.name]: FieldValue.arrayUnion(addedValue)})
      break
    case SyncType.SETDEL:
      const deletedValue = valueToFirestore(sync.elem, sync.etype)
      this.ref.update({[meta.name]: FieldValue.arrayRemove(deletedValue)})
      break
    case SyncType.MAPSET:
      const setValue = valueToFirestore(sync.value, sync.vtype)
      this.ref.update({[`${meta.name}.${sync.key}`]: setValue})
      break
    case SyncType.MAPDEL:
      this.ref.update({[`${meta.name}.${sync.key}`]: FieldValue.delete()})
      break
    }
  }
}

export class FirebaseDataStore extends DataStore {
  readonly db = firebase.firestore()

  protected createResolved (path :Path, otype :DObjectType<any>) :Resolved {
    return new FirebaseResolved(this.db, this, path, otype)
  }
}
