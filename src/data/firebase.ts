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
import {Path, PathMap} from "../core/path"
import {Data, DataMapKey, Record} from "../core/data"
import {UUID} from "../core/uuid"
import {Encoder, Decoder, SyncSet, SyncMap, KeyType, ValueType, setTextCodec} from "../core/codec"
import {SyncMsg, ObjType} from "./protocol"
import {MapMeta, getPropMetas, isPersist} from "./meta"
import {DObject, DObjectType, DMutable} from "./data"
import {DataStore, Resolved, Resolver, ResolvedView} from "./server"

const DebugLog = false

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

type DatabaseOrDocRef = Firestore | DocRef

function pathToDocRef (db :Firestore, rtype :DObjectType<any>, path :Path) :DocRef {
  if (path.length < 1) throw new Error(`Can't make doc ref for ${path}`)

  let ref = db as DatabaseOrDocRef
  let curtype = rtype, idx = 0
  while (idx < path.length) {
    const curmetas = getPropMetas(curtype.prototype)
    const colname = path[idx] as string, col = curmetas.find(m => m.name === colname)
    if (!col) throw new Error(`Missing metadata for path component [path=${path}, idx=${idx}]`)
    switch (col.type) {
    case "collection":
      curtype = col.otype(path[idx+1])
      ref = ref.collection(path[idx]).doc(path[idx+1])
      idx += 2 // skip the collection name and key
      break
    case "singleton":
      curtype = col.otype
      ref = ref.collection("singletons").doc(path[idx])
      idx += 1 // skip the singleton name
      break
    default:
      const etype = (idx < path.length-2) ? "collection" : "singleton"
      throw new Error(`Expected '${etype}' property at path component [path=${path}, idx=${idx}]`)
    }
  }
  return ref as DocRef
}

function pathToColRef (db :Firestore, rtype :DObjectType<any>, path :Path) :ColRef {
  if (path.length < 2) throw new Error(`Can't make col ref for ${path}`)
  return pathToDocRef(db, rtype, path.slice(0, path.length-1)).collection(path[path.length-1])
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

function keyToString (key :any, ktype :KeyType) :string {
  if (ktype === "string" || ktype === "uuid") return key
  else if (ktype === "undefined" || ktype === "null") return ""
  else if (ktype === "timestamp") return `${(key as Timestamp).millis}`
  else return `${key}` // numeric or boolean
}

function keyFromString (key :string, ktype :KeyType) :any {
  if (ktype === "string" || ktype === "uuid") return key
  else if (ktype === "undefined") return undefined
  else if (ktype === "null") return null
  else if (ktype === "timestamp") return new Timestamp(+key)
  else if (ktype === "boolean") return key === "true"
  else return +key // numeric
}

function mapFromFirestore<K,V> (data :any, ktype :KeyType, vtype :ValueType,
                                into :SyncMap<K,V>) {
  const keys = [], vals :V[] = []
  for (const key in data) {
    keys.push(keyFromString(key, ktype))
    vals.push(valueFromFirestore(data[key], vtype))
  }
  for (const key of into.keys()) if (!keys.includes(key)) into.delete(key, true)
  for (let ii = 0; ii < keys.length; ii += 1) into.set(keys[ii], vals[ii], true)
}

function applySnap (snap :DocSnap, object :DObject) {
  for (const meta of object.metas) {
    if (!isPersist(meta)) continue
    const value = snap.get(meta.name)
    if (value === undefined) continue // TEMP: todo, handle undefined `value` props
    const prop = object[meta.name]
    switch (meta.type) {
    case "value": (prop as DMutable<any>).update(
        valueFromFirestore(value, meta.vtype), true) ; break
    case "set": setFromFirestore(value, meta.etype, (prop as SyncSet<any>)) ; break
    case "map": mapFromFirestore(
        value, meta.ktype, meta.vtype, (prop as SyncMap<any,any>)) ; break
    default: break // nothing to sync for collection & queue props
    }
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

const DEFAULT_FLUSH_FREQ = 60 * 1000

type ValDelta = {type :"value", value :any}
type SetDelta = {type :"set", add :Set<Data>, del :Set<Data>}
type MapDelta = {type :"map", ktype :KeyType, set :Map<DataMapKey,Data>, del :Set<DataMapKey>}
type Delta = ValDelta | SetDelta | MapDelta
type Update = {[key :string] :Delta}

function getSetDelta (update :Update, prop :string) :SetDelta {
  const delta = update[prop]
  if (!delta) return (update[prop] = {type: "set", add: new Set<Data>(), del: new Set<Data>()})
  else if (delta.type === "set") return delta
  else throw new Error(`Expected set delta, got ${delta.type} (for ${prop})`)
}

function getMapDelta (update :Update, prop :string, ktype :KeyType) :MapDelta {
  const delta = update[prop]
  if (!delta) return (update[prop] = {
    type: "map", ktype, set: new Map<DataMapKey,Data>(), del: new Set<DataMapKey>()})
  else if (delta.type === "map") return delta
  else throw new Error(`Expected map delta, got ${delta.type} (for ${prop})`)
}

class DocSyncer {
  private update :Update = {}
  private needsFlush = false
  public needCreate = false

  constructor (readonly path :Path, readonly ref :DocRef) {
    if (DebugLog) log.debug("Created syncer", "path", path)
  }

  addSync (object :DObject, sync :SyncMsg) {
    const meta = object.metas[sync.idx], update = this.update
    // if (DebugLog) log.debug("syncToUpdate", "path", object.path, "type", sync.type,
    //                         "name", meta.name)
    switch (sync.type) {
    case ObjType.VALSET:
      update[meta.name] = {type: "value", value: valueToFirestore(sync.value, sync.vtype)}
      break
    case ObjType.SETADD:
      const addedValue = valueToFirestore(sync.elem, sync.etype)
      const addDelta = getSetDelta(update, meta.name)
      addDelta.del.delete(addedValue)
      addDelta.add.add(addedValue)
      break
    case ObjType.SETDEL:
      const deletedValue = valueToFirestore(sync.elem, sync.etype)
      const delDelta = getSetDelta(update, meta.name)
      delDelta.add.delete(deletedValue)
      delDelta.del.add(deletedValue)
      break
    case ObjType.MAPSET:
      const setValue = valueToFirestore(sync.value, sync.vtype)
      const setDelta = getMapDelta(update, meta.name, (meta as MapMeta).ktype)
      setDelta.set.set(sync.key, setValue)
      setDelta.del.delete(sync.key)
      break
    case ObjType.MAPDEL:
      const mdelDelta = getMapDelta(update, meta.name, (meta as MapMeta).ktype)
      mdelDelta.set.delete(sync.key)
      mdelDelta.del.add(sync.key)
      break
    }
    this.needsFlush = true
  }

  async flush () {
    if (!this.needsFlush) return

    const update = this.update, ref = this.ref, data :DocData = {}
    let deleteData :DocData|undefined = undefined
    for (const key in update) {
      const delta = update[key]
      switch (delta.type) {
      case "value":
        data[key] = delta.value
        break

      case "set":
        if (delta.add.size > 0) {
          data[key] = FieldValue.arrayUnion(...delta.add)
          // we can't add and delete to a set in the same operation, so delete separately
          if (delta.del.size > 0) {
            if (!deleteData) deleteData = {}
            deleteData[key] = FieldValue.arrayRemove(...delta.del)
          }
        }
        else if (delta.del.size > 0) data[key] = FieldValue.arrayRemove(...delta.del)
        else log.warn("No add or del in set delta?", "path", this.path, "prop", key, "delta", delta)
        break

      case "map":
        const ktype = delta.ktype
        for (const [k, v] of delta.set) data[`${key}.${keyToString(k, ktype)}`] = v
        for (const k of delta.del) data[`${key}.${keyToString(k, ktype)}`] = FieldValue.delete()
        break
      }
    }

    if (this.needCreate) {
      await ref.set({}, {merge: true})
      this.needCreate = false
    }
    ref.update(data)
    if (DebugLog) log.debug("persistUpdate", "path", this.path, "keys", Object.keys(data))
    if (deleteData) {
      if (DebugLog) log.debug("persistUpdate.delete", "path", this.path,
                              "props", Object.keys(deleteData))
      ref.update(data)
    }
    this.update = {}
    this.needsFlush = false
  }
}

export class FirebaseDataStore extends DataStore {
  readonly db = firebase.firestore()
  readonly syncers = new PathMap<DocSyncer>()
  private readonly flushTimer :NodeJS.Timeout

  constructor (rtype :DObjectType<any>, flushFreq = DEFAULT_FLUSH_FREQ) {
    super(rtype)
    log.info("Firebase datastore syncing every " + flushFreq/1000 + "s")
    this.flushTimer = setInterval(() => this.flushUpdates(), flushFreq)
  }

  createRecord (path :Path, key :UUID, data :Record) {
    const ref = pathToColRef(this.db, this.rtype, path).doc(key)
    if (DebugLog) log.debug("createRecord", "path", path, "key", key)
    ref.set(recordToFirestore(data))
  }
  updateRecord (path :Path, key :UUID, data :Record, merge :boolean) {
    const ref = pathToColRef(this.db, this.rtype, path).doc(key)
    if (DebugLog) log.debug("updateRecord", "path", path, "key", key)
    merge ? ref.set(data) : ref.update(recordToFirestore(data))
  }
  deleteRecord (path :Path, key :UUID) {
    const ref = pathToColRef(this.db, this.rtype, path).doc(key)
    if (DebugLog) log.debug("deleteRecord", "path", path, "key", key)
    ref.delete()
  }

  resolveData (res :Resolved, resolver? :Resolver) {
    const ref = pathToDocRef(this.db, this.rtype, res.object.path)
    const syncer = new DocSyncer(res.object.path, ref)
    this.syncers.set(res.object.path, syncer)
    if (resolver) {
      resolver(res.object)
      res.resolvedData()
    } else {
      const unlisten = ref.onSnapshot(snap => {
        if (snap.exists) {
          try { applySnap(snap, res.object) }
          catch (err) {
            log.warn("Failed to apply snapshot", "obj", res.object, err)
          }
        }
        // the first time we hear back from Firebase, the sync doc may not exist; in that case we
        // have to tell the syncer to create it before its first sync to the doc
        else syncer.needCreate = true
        res.resolvedData()
      })
      res.object.state.whenOnce(s => s === "disposed", _ => unlisten())
    }
  }

  resolveViewData (res :ResolvedView) {
    const cref = pathToColRef(this.db, this.rtype, res.tpath)
    // TODO: refine query based on res.vmeta
    const unlisten = cref.onSnapshot(snap => {
      const sets = []
      for (const change of snap.docChanges()) {
        const doc = change.doc
        if (DebugLog) log.debug("View snap", "type", change.type, "path", res.tpath, "id", doc.id)
        switch (change.type) {
        case "added":
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
    const syncer = this.syncers.get(obj.path)
    if (!syncer) log.warn("Missing ref for sync persist", "obj", obj)
    else syncer.addSync(obj, msg)
  }

  private flushUpdates () {
    this.syncers.forEach(syncer => syncer.flush())
  }

  shutdown () :Promise<void> {
    this.flushUpdates()
    clearInterval(this.flushTimer)
    return this.db.waitForPendingWrites()
  }
}
