import {Timestamp, log} from "./util"
import {UUID, uuidToString, uuidFromString} from "./uuid"
import {Path} from "./path"
import {Data, DataArray, DataMap, DataMapKey, DataSet, Record, isMap, isSet} from "./data"

export type KeyType = "undefined" | "null" | "boolean" | "int8" | "int16" | "int32"
                    | "size8" | "size16" | "size32" | "float32" | "float64" | "varSize"
                    | "varInt" | "number" | "string" | "timestamp" | "uuid"
// TODO: support "text" value type which supported >64k of text?
export type ValueType = KeyType | "data" | "record"

//
// Encoder/decoder functions

type DataEncoder<T> = (enc :Encoder, v:T) => void
type DataDecoder<T> = (dec :Decoder) => T

const addVoid    = (e :Encoder, v :void) => {}
const addNull    = (e :Encoder, n :null) => {}
const addBoolean = (e :Encoder, b :boolean) => { addInt8(e, b ? 1 : 0) }
const addInt8    = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(1).setInt8(p, s) }
const addInt16   = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(2).setInt16(p, s) }
const addInt32   = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(4).setInt32(p, s) }
const addSize8   = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(1).setUint8(p, s) }
const addSize16  = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(2).setUint16(p, s) }
const addSize32  = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(4).setUint32(p, s) }
const addFloat32 = (e :Encoder, v :number) => { const p = e.pos ; e.prepAdd(4).setFloat32(p, v) }
const addFloat64 = (e :Encoder, v :number) => { const p = e.pos ; e.prepAdd(8).setFloat64(p, v) }
const addVarSize = (e :Encoder, v :number) => {
  while (true) {
    let byte = v & 0x7F
    v >>= 7
    if (v === 0) {
      addSize8(e, byte)
      return
    }
    addSize8(e, byte | 0x80)
  }
}
const addVarInt = (e :Encoder, v :number) => {
  addVarSize(e, v < 0 ? (-v << 1) - 1 : (v << 1))
}

function addString (enc :Encoder, text :string) {
  if (text.length === 0) {
    addSize16(enc, 0)
    return
  }

  // if the string is too long before encoding, it will definitely be too long after
  if (text.length > 65535) throw new Error(
    `String length cannot exceed 64k when converted to UTF-8 (length: ${text.length})`)

  const {pos, encoder} = enc
  // if we don't have encodeInto then we have to encode the string into a separate byte buffer and
  // copy that byte buffer into our encoding buffer...
  if (!encoder.encodeInto) {
    const encoded = encoder.encode(text)
    if (encoded.length > 65535) throw new Error(
      `String length cannot exceed 64k when converted to UTF-8 (bytes: ${encoded.length})`)
    addSize16(enc, encoded.length)
    const tpos = enc.pos
    enc.prepAdd(encoded.length)
    new Uint8Array(enc.buffer, tpos).set(encoded)
    return
  }

  // if we do have encodeInto then we have to deal with the vagaries of not knowing how many UTF-8
  // bytes we're going to get after encoding the string; we do this in stages to avoid blowing up
  // our encoding buffer any time we write a string of non-trivial size
  const tryEncodeInto = (size :number) => {
    const tpos = enc.pos
    enc.prepAdd(size)
    const result = enc.encoder.encodeInto(text, new Uint8Array(enc.buffer, tpos))
    if (result.read !== text.length || !result.written) {
      enc.pos = tpos
      return false
    }
    enc.data.setUint16(pos, result.written)
    enc.pos = tpos + result.written
    return true
  }
  // leave space for the length
  enc.prepAdd(2)
  // try encoding with just a bit of extra space for >8-bit characters
  if (!tryEncodeInto(Math.ceil(text.length*1.25))) {
    // try again with two bytes per byte
    if (!tryEncodeInto(Math.ceil(text.length*2))) {
      // in theory 3 bytes per byte is guaranteed to succeed
      if (!tryEncodeInto(Math.ceil(text.length*3))) throw new Error(
        `Unable to encode string to UTF-8? (length: ${text.length})`)
    }
  }
}

function addTimestamp (enc :Encoder, stamp :Timestamp) {
  addFloat64(enc, stamp.millis)
}

function addUUID (enc :Encoder, uuid :UUID) {
  const p = enc.pos
  enc.prepAdd(16)
  try {
    uuidFromString(uuid, enc.bytes, p)
  } catch (error) {
    log.warn(`${enc.eid}: Unable to add UUID at ${p} (cap ${enc.buffer.byteLength})`, error)
  }
}

function addDataIterable (enc :Encoder, iter :Iterable<Data>, size :number) {
  addSize32(enc, size)
  if (size > 0) {
    const typeId = valuesTypeId(iter)
    const encoder = requireEncoder(typeId)
    addSize16(enc, typeId)
    for (const elem of iter) encoder(enc, elem)
  }
}

const addDataArray = (enc :Encoder, arr :DataArray) => addDataIterable(enc, arr, arr.length)

function addFloatArray (enc :Encoder, arr :Float32Array) {
  const length = arr.length
  addSize32(enc, length)
  for (let ii = 0; ii < length; ii += 1) addFloat32(enc, arr[ii])
}

const addDataSet = (enc :Encoder, set :DataSet) => addDataIterable(enc, set, set.size)

function addDataMap (enc :Encoder, map :DataMap) {
  addSize32(enc, map.size)
  if (map.size > 0) {
    const ktypeId = valuesTypeId(map.keys()), kencoder = requireEncoder(ktypeId)
    const vtypeId = valuesTypeId(map.values()), vencoder = requireEncoder(vtypeId)
    addSize16(enc, ktypeId)
    addSize16(enc, vtypeId)
    for (const [key, val] of map) {
      kencoder(enc, key)
      vencoder(enc, val)
    }
  }
}

function addData (enc :Encoder, data :Data) {
  const typeId = dataTypeId(data)
  addSize16(enc, typeId)
  requireEncoder(typeId)(enc, data)
}

function addRecord (enc :Encoder, rec :Record) {
  const props = Object.getOwnPropertyNames(rec)
  addSize16(enc, props.length)
  for (const prop of props) {
    addString(enc, prop)
    addData(enc, rec[prop])
  }
}

function addValue (enc :Encoder, data :any, type :ValueType) {
  const encoder = valueCodecs[type][0]
  if (encoder) encoder(enc, data)
  else throw new Error(`Unknown value type '${type}'`)
}

const getVoid    = (dec :Decoder) => undefined
const getNull    = (dec :Decoder) => null
const getBoolean = (dec :Decoder) => dec.data.getUint8(dec.prepGet(1)) === 1
const getInt8    = (dec :Decoder) => dec.data.getInt8(dec.prepGet(1))
const getInt16   = (dec :Decoder) => dec.data.getInt16(dec.prepGet(2))
const getInt32   = (dec :Decoder) => dec.data.getInt32(dec.prepGet(4))
const getSize8   = (dec :Decoder) => dec.data.getUint8(dec.prepGet(1))
const getSize16  = (dec :Decoder) => dec.data.getUint16(dec.prepGet(2))
const getSize32  = (dec :Decoder) => dec.data.getUint32(dec.prepGet(4))
const getFloat32 = (dec :Decoder) => dec.data.getFloat32(dec.prepGet(4))
const getFloat64 = (dec :Decoder) => dec.data.getFloat64(dec.prepGet(8))
const getVarSize = (dec :Decoder) => {
  let size = 0
  let shift = 0
  while (true) {
    const byte = getSize8(dec)
    size |= (byte & 0x7F) << shift
    if (!(byte & 0x80)) return size
    shift += 7
  }
}
const getVarInt = (dec :Decoder) => {
  const size = getVarSize(dec)
  return (size & 1) ? -((size + 1) >> 1) : (size >> 1)
}

function getString (dec :Decoder) {
  const bytes = getSize16(dec)
  if (bytes === 0) return ""
  const offset = dec.prepGet(bytes)
  return dec.decoder.decode(dec.source.subarray(offset, offset+bytes))
}

function getTimestamp (dec :Decoder) {
  return new Timestamp(getFloat64(dec))
}

function getUUID (dec :Decoder) {
  const offset = dec.prepGet(16)
  return uuidToString(dec.source.subarray(offset, offset+16))
}

function getDataArray (dec :Decoder) {
  const arr :DataArray = []
  const size = getSize32(dec)
  if (size > 0) {
    const decoder = requireDecoder<Data>(getSize16(dec))
    for (let ii = 0; ii < size; ii += 1) arr.push(decoder(dec))
  }
  return arr
}

function getFloatArray (dec :Decoder) {
  const size = getSize32(dec)
  const arr = new Float32Array(size)
  for (let ii = 0; ii < size; ii += 1) arr[ii] = getFloat32(dec)
  return arr
}

const getDataSet = (dec :Decoder) => new Set(getDataArray(dec))

function getDataMap (dec :Decoder) {
  const map :DataMap = new Map()
  const size = getSize32(dec)
  if (size > 0) {
    const kdecoder = requireDecoder<DataMapKey>(getSize16(dec))
    const vdecoder = requireDecoder<Data>(getSize16(dec))
    for (let ii = 0; ii < size; ii += 1) map.set(kdecoder(dec), vdecoder(dec))
  }
  return map
}

function getData (dec :Decoder) {
  const typeId = getSize16(dec)
  const decoder = dataDecoders.get(typeId)
  if (decoder) return decoder(dec)
  throw new Error(`Unknown data type id '${typeId}'`)
}

function getRecord (dec :Decoder) {
  const rec :Record = {}, props = getSize16(dec)
  for (let ii = 0; ii < props; ii += 1) rec[getString(dec)] = getData(dec)
  return rec
}

function getValue (dec :Decoder, type :ValueType) :any {
  const decoder = valueCodecs[type][1]
  if (decoder) return decoder(dec)
  new Error(`Unknown value type '${type}'`)
}

//
// Extensible tagged encoder/decoders

const dataEncoders :Map<number,DataEncoder<any>> = new Map()
const dataDecoders :Map<number,DataDecoder<any>> = new Map()

function registerCodec<T> (id :number, encoder :DataEncoder<T>, decoder :DataDecoder<T>) :number {
  if (dataEncoders.has(id)) throw new Error(`Codec id already in use: ${id}`)
  dataEncoders.set(id, encoder)
  dataDecoders.set(id, decoder)
  return id
}

/** The minimum id number usable by custom class codecs. */
export const MIN_CUSTOM_ID = 64

/** Registers a codec for a custom class. This allows the class to be stored in properties with type
  * `data` or to be included in the POJOs used in `record` properties.
  *
  * A globally unique numeric id must be provided to distinguish this custom class from all others.
  * This id must be unique within an entire system and an error will be thrown if another type is
  * already registered with this id. If encoded data is persisted, this id must also never change or
  * the persisted data will become unreadable.
  *
  * This must be called on the client and server before any calls that might attempt to encode or
  * decode data containing the custom class.
  *
  * @param proto the prototype for the class (i.e. `Vector3.prototype`).
  * @param id the numeric id that represents this type in serialized data.
  * @param enc an encoder for instances of that class.
  * @param dec a decoder for instances of that class.
  */
export function registerCustomCodec<T> (
  id :number, proto :Object, enc :DataEncoder<T>, dec :DataDecoder<T>
) {
  if (id < MIN_CUSTOM_ID) throw new Error(`Custom codecs must have id >= ${MIN_CUSTOM_ID}`)
  proto["__typeId"] = registerCodec(id, enc, dec)
}

// note: these numeric ids will inevitably be persisted and thus must not change
const UNDEF_ID  = 0 ; registerCodec<void>(UNDEF_ID, addVoid, getVoid)
const BOOL_ID   = 1 ; registerCodec<boolean>(BOOL_ID, addBoolean, getBoolean)
const NUMBER_ID = 2 ; registerCodec<number>(NUMBER_ID, addFloat64, getFloat64)
const STRING_ID = 3 ; registerCodec<string>(STRING_ID, addString, getString)
const ARRAY_ID  = 4 ; registerCodec<DataArray>(ARRAY_ID, addDataArray, getDataArray)
const SET_ID    = 5 ; registerCodec<DataSet>(SET_ID, addDataSet, getDataSet)
const MAP_ID    = 6 ; registerCodec<DataMap>(MAP_ID, addDataMap, getDataMap)
const STAMP_ID  = 7 ; registerCodec<Timestamp>(STAMP_ID, addTimestamp, getTimestamp)
const RECORD_ID = 8 ; registerCodec<Record>(RECORD_ID, addRecord, getRecord)
const DATA_ID   = 9 ; registerCodec<Data>(DATA_ID, addData, getData)
const NULL_ID   = 10 ; registerCodec<null>(NULL_ID, addNull, getNull)
const FLOATV_ID = 11 ; registerCodec<Float32Array>(FLOATV_ID, addFloatArray, getFloatArray)

function dataTypeId (data :Data) :number {
  if (data === undefined) return UNDEF_ID
  else if (data === null) return NULL_ID
  else if (typeof data === "boolean") return BOOL_ID
  else if (typeof data === "number") return NUMBER_ID
  else if (typeof data === "string") return STRING_ID
  else if (Array.isArray(data)) return ARRAY_ID
  else if (isSet(data)) return SET_ID
  else if (isMap(data)) return MAP_ID
  else if (data instanceof Timestamp) return STAMP_ID
  else if (data instanceof Float32Array) return FLOATV_ID
  else if ("__typeId" in data) return data["__typeId"] as number
  else return RECORD_ID
}

function requireEncoder<T> (typeId :number) :DataEncoder<T> {
  const encoder = dataEncoders.get(typeId)
  if (encoder) return encoder
  throw new Error(`No encoder for data type ${typeId}?`)
}

function requireDecoder<T> (typeId :number) :DataDecoder<T> {
  const decoder = dataDecoders.get(typeId)
  if (decoder) return decoder
  throw new Error(`No decoder for data type ${typeId}?`)
}

function valuesTypeId (iter :Iterable<Data>) :number {
  let id = -1
  for (const elem of iter) {
    if (id === -1) id = dataTypeId(elem)
    // if the array contains different types, use 'data'
    // which will prefix each element with a type marker
    else if (dataTypeId(elem) !== id) return DATA_ID
  }
  if (id === -1) throw new Error(`valuesTypeId not valid for empty iterables`)
  return id
}

//
// General encoding/decoding APIs

const valueCodecs :{[key :string]: [DataEncoder<any>, DataDecoder<any>]} = {
  undefined: [addVoid,      getVoid],
  null     : [addNull,      getNull],
  boolean  : [addBoolean,   getBoolean],
  int8     : [addInt8,      getInt8],
  int16    : [addInt16,     getInt16],
  int32    : [addInt32,     getInt32],
  size8    : [addSize8,     getSize8],
  size16   : [addSize16,    getSize16],
  size32   : [addSize32,    getSize32],
  float32  : [addFloat32,   getFloat32],
  float64  : [addFloat64,   getFloat64],
  number   : [addFloat64,   getFloat64],
  varSize  : [addVarSize,   getVarSize],
  varInt   : [addVarInt,    getVarInt],
  string   : [addString,    getString],
  timestamp: [addTimestamp, getTimestamp],
  uuid     : [addUUID,      getUUID],
  data     : [addData,      getData],
  record   : [addRecord,    getRecord]
}

// hacky crap to work around Jest weirdness
let mkTextEncoder = () => new TextEncoder()
let mkTextDecoder = () => new TextDecoder()
export function setTextCodec (mkEnc :() => TextEncoder, mkDec :() => TextDecoder) {
  mkTextEncoder = mkEnc
  mkTextDecoder = mkDec
}

const DefaultEncoderSize = 256
const EncoderExpandSize = 256

let eid = 0

export class Encoder {
  readonly encoder = mkTextEncoder()
  buffer = new ArrayBuffer(DefaultEncoderSize)
  data = new DataView(this.buffer)
  bytes = new Uint8Array(this.buffer)
  pos = 0
  readonly eid :number

  constructor () {
    this.eid = ++eid
  }

  prepAdd (size :number) :DataView {
    const npos = this.pos + size, capacity = this.buffer.byteLength
    if (npos >= capacity) {
      let ncapacity = capacity + EncoderExpandSize
      while (ncapacity <= npos) ncapacity += EncoderExpandSize
      const nbuffer = new ArrayBuffer(ncapacity)
      new Uint8Array(nbuffer).set(new Uint8Array(this.buffer), 0)
      this.buffer = nbuffer
      this.bytes = new Uint8Array(nbuffer)
      this.data = new DataView(nbuffer)
    }
    this.pos = npos
    return this.data
  }

  addValue (data :any, type :ValueType) { addValue(this, data, type) }

  addArray (data :any[], etype :ValueType) {
    addSize32(this, data.length)
    for (const elem of data) addValue(this, elem, etype)
  }

  addSet (set :ReadonlySet<any>, etype :KeyType) {
    addSize32(this, set.size)
    for (const elem of set) addValue(this, elem, etype)
  }

  addMap (map :ReadonlyMap<any, any>, ktype :KeyType, vtype :ValueType) {
    addSize32(this, map.size)
    for (const [key, value] of map.entries()) {
      addValue(this, key, ktype)
      addValue(this, value, vtype)
    }
  }

  addPath (path :Path) {
    if (path.length > 255) throw new Error(`Path too long: ${path}`)
    this.addValue(path.length, "size8")
    for (let ii = 0, ll = path.length; ii < ll; ii += 1) {
      this.addValue(path[ii], ii % 2 == 0 ? "string" : "uuid")
    }
  }

  finish () :Uint8Array {
    const encoded = new Uint8Array(this.buffer, 0, this.pos)
    this.reset()
    return encoded
  }

  reset () {
    this.pos = 0
  }
}

export interface SyncSet<E> extends Set<E> {
  add (elem :E, fromSync? :boolean) :this
  delete (elem :E, fromSync? :boolean) :boolean
}

export interface SyncMap<K,V> extends Map<K,V>{
  set (key :K, value :V, fromSync? :boolean) :this
  delete (key :K, fromSync? :boolean) :boolean
}

export class Decoder {
  readonly decoder = mkTextDecoder()
  readonly data :DataView
  pos = 0

  constructor (readonly source :Uint8Array) {
    this.data = new DataView(source.buffer, source.byteOffset, source.byteLength)
  }

  prepGet (size :number) {
    const pos = this.pos
    this.pos += size
    return pos
  }

  getValue (type :ValueType) :any { return getValue(this, type) }

  getArray<E> (etype :ValueType) :E[] {
    const data :E[] = [], len = getSize32(this)
    for (let ii = 0; ii < len; ii += 1) data[ii] = getValue(this, etype)
    return data
  }

  getSet<E> (etype :KeyType, into :Set<E>) :Set<E> {
    const size = getSize32(this)
    for (let ii = 0; ii < size; ii += 1) into.add(getValue(this, etype))
    return into
  }

  syncSet<E> (etype :KeyType, into :SyncSet<E>) {
    const size = getSize32(this)
    const tmp = new Set<E>()
    for (let ii = 0; ii < size; ii += 1) tmp.add(getValue(this, etype))
    for (const elem of into) if (!tmp.has(elem)) into.delete(elem, true)
    for (const elem of tmp) into.add(elem, true)
    return into
  }

  getMap<K,V> (ktype :KeyType, vtype :ValueType, into :Map<K,V>) :Map<K,V> {
    const size = getSize32(this)
    for (let ii = 0; ii < size; ii += 1) into.set(getValue(this, ktype), getValue(this, vtype))
    return into
  }

  syncMap<K,V> (ktype :KeyType, vtype :ValueType, into :SyncMap<K,V>) {
    const size = getSize32(this)
    const keys = [], vals :V[] = []
    for (let ii = 0; ii < size; ii += 1) {
      keys.push(getValue(this, ktype))
      vals.push(getValue(this, vtype))
    }
    for (const key of into.keys()) if (!keys.includes(key)) into.delete(key, true)
    for (let ii = 0; ii < size; ii += 1) into.set(keys[ii], vals[ii], true)
    return into
  }

  getPath () :Path {
    const path :Path = [], length = this.getValue("size8")
    for (let ii = 0, ll = length; ii < ll; ii += 1) {
      path.push(this.getValue(ii % 2 == 0 ? "string" : "uuid"))
    }
    return path
  }
}
