import * as firebase from "firebase/app"
import "firebase/firestore"

type Firestore = firebase.firestore.Firestore
type DocRef = firebase.firestore.DocumentReference
type DocSnap = firebase.firestore.DocumentSnapshot
type DocData = firebase.firestore.DocumentData
type ColRef = firebase.firestore.CollectionReference
type FTimestamp = firebase.firestore.Timestamp
type Blob = firebase.firestore.Blob
const FTimestamp = firebase.firestore.Timestamp
const FieldValue = firebase.firestore.FieldValue
const Blob = firebase.firestore.Blob

import {TextEncoder, TextDecoder} from "util"
import {Timestamp, log} from "../core/util"
import {Data, Record} from "../core/data"
import {UUID} from "../core/uuid"
import {Encoder, Decoder, SyncSet, SyncMap, ValueType, setTextCodec} from "../core/codec"
import {SyncMsg, SyncType} from "./protocol"
import {DObject, DMutable, Path} from "./data"
import {DataStore, Resolved, Resolver, ResolvedView} from "./server"

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

function pathToDocRef (db :Firestore, path :Path) :DocRef {
  if (path.length < 2 || path.length % 2 != 0) throw new Error(`Can't make doc ref for ${path}`)
  let ref = db.collection(path[0]).doc(path[1])
  let idx = 2
  while (idx < path.length) {
    ref = ref.collection(path[idx]).doc(path[idx+1])
    idx += 2
  }
  return ref
}

function pathToColRef (db :Firestore, path :Path) :ColRef {
  if (path.length < 1 || path.length % 2 != 1) throw new Error(`Can't make col ref for ${path}`)
  let ref = db.collection(path[0])
  let idx = 1
  while (idx < path.length) {
    ref = ref.doc(path[idx]).collection(path[idx+1])
    idx += 2
  }
  return ref
}

const encoder = new Encoder()

function dataToBlob (value :Data) :Blob {
  encoder.addValue(value, "data")
  return Blob.fromUint8Array(encoder.finish()) // TODO: clone Uint8Array?
}

function dataFromBlob (value :Blob) :Data {
  const decoder = new Decoder(value.toUint8Array())
  return decoder.getValue("data") as Data
}

function recordToBlob (value :Record) :Blob {
  encoder.addValue(value, "record")
  return Blob.fromUint8Array(encoder.finish()) // TODO: clone Uint8Array?
}

function recordFromBlob (value :Blob) :Record {
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
  case "timestamp": return FTimestamp.fromMillis(value.millis)
  case "uuid": return value as UUID // UUID is string in JS and Firestore
  case "data": return dataToBlob(value)
  case "record": return recordToBlob(value)
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
  case "timestamp": return new Timestamp((value as FTimestamp).toMillis())
  case "uuid": return value as string // UUID is a string in JS and Firestore
  case "data": return dataFromBlob(value)
  case "record": return recordFromBlob(value)
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

function applySnap (snap :DocSnap, object :DObject) {
  for (const meta of object.metas) {
    const value = snap.get(meta.name)
    if (value === undefined) continue // TEMP: todo, handle undefined `value` props
    const prop = object[meta.name]
    switch (meta.type) {
    case "value": (prop as DMutable<any>).update(
        valueFromFirestore(value, meta.vtype), true) ; break
    case "set": setFromFirestore(value, meta.etype, (prop as SyncSet<any>)) ; break
    case "map": mapFromFirestore(value, meta.vtype, (prop as SyncMap<string,any>)) ; break
    default: break // nothing to sync for collection & queue props
    }
  }
}

function syncToDoc (object :DObject, sync :SyncMsg, ref :DocRef) {
  const meta = object.metas[sync.idx]
  switch (sync.type) {
  case SyncType.VALSET:
    ref.set({[meta.name]: valueToFirestore(sync.value, sync.vtype)}, {merge: true})
    break
  case SyncType.SETADD:
    const addedValue = valueToFirestore(sync.elem, sync.etype)
    ref.update({[meta.name]: FieldValue.arrayUnion(addedValue)})
    break
  case SyncType.SETDEL:
    const deletedValue = valueToFirestore(sync.elem, sync.etype)
    ref.update({[meta.name]: FieldValue.arrayRemove(deletedValue)})
    break
  case SyncType.MAPSET:
    const setValue = valueToFirestore(sync.value, sync.vtype)
    ref.update({[`${meta.name}.${sync.key}`]: setValue})
    break
  case SyncType.MAPDEL:
    ref.update({[`${meta.name}.${sync.key}`]: FieldValue.delete()})
    break
  }
}

function needsConvert (data :Object) {
  for (const key in data) {
    const value = data[key]
    if (value instanceof Timestamp || value instanceof FTimestamp) return true
  }
  return false
}

function dataToFirestore (value :any) :any {
  if (value instanceof Timestamp) return FTimestamp.fromMillis(value.millis)
  else return value
}
function dataFromFirestore (value :any) :any {
  if (value instanceof FTimestamp) return new Timestamp((value as FTimestamp).toMillis())
  else return value
}
function recordToFirestore (data :Record) :Object {
  if (!needsConvert(data)) return data
  const fire = {}
  for (const key in data) {
    fire[key] = dataToFirestore(data[key])
  }
  return fire
}
function recordFromFirestore (data :DocData) :Record {
  if (!needsConvert(data)) return data
  const rec = {}
  for (const key in data) {
    rec[key] = dataFromFirestore(data[key])
  }
  return rec
}

export class FirebaseDataStore extends DataStore {
  readonly db = firebase.firestore()
  readonly refs = new Map<UUID, DocRef>()

  createRecord (path :Path, key :UUID, data :Record) {
    const ref = pathToColRef(this.db, path).doc(key)
    ref.set(recordToFirestore(data))
  }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    const ref = pathToColRef(this.db, path).doc(key)
    merge ? ref.set(data) : ref.update(recordToFirestore(data))
  }
  deleteRecord (path :Path, key :UUID) {
    const ref = pathToColRef(this.db, path).doc(key)
    ref.delete()
  }

  resolveData (res :Resolved, resolver? :Resolver) {
    const ref = pathToDocRef(this.db, res.object.path)
    if (resolver) {
      resolver(res.object)
      res.resolvedData()
    } else {
      const unlisten = ref.onSnapshot(snap => {
        if (snap.exists) applySnap(snap, res.object)
        else ref.set({})
        res.resolvedData()
      })
      res.object.state.whenOnce(s => s === "disposed", _ => unlisten())
    }
    this.refs.set(res.object.key, ref)
  }

  resolveViewData (res :ResolvedView) {
    const cref = pathToColRef(this.db, res.tpath)
    // TODO: refine query based on res.vmeta
    const unlisten = cref.onSnapshot(snap => {
      const sets = []
      for (const change of snap.docChanges()) {
        const doc = change.doc
        log.debug("View snap", "type", change.type, "path", res.tpath, "id", doc.id)
        switch (change.type) {
        case "added":
          log.debug("added", "data", doc.data())
          sets.push({key: doc.id, data: recordFromFirestore(doc.data())})
          break
        case "modified":
          sets.push({key: doc.id, data: recordFromFirestore(doc.data())})
          break
        case "removed":
          res.recordDelete(doc.id)
          break
        }
      }
      if (sets.length > 0) res.recordSet(sets)
      res.resolvedRecords()
    })
    res.state.whenOnce(s => s === "disposed", _ => unlisten())
  }

  persistSync (obj :DObject, msg :SyncMsg) {
    const ref = this.refs.get(obj.key)
    if (ref) syncToDoc(obj, msg, ref)
    else log.warn("Missing ref for sync persist", "obj", obj)
  }
}
