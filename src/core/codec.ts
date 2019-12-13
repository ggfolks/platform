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
// Extensible tagged encoder/decoders

type DataEncoder<T> = (enc :Encoder, v:T) => void
type DataDecoder<T> = (dec :Decoder) => T

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

//
// Encoder/decoder functions

const addVoid    = (e :Encoder, v :void) => {}
const addNull    = (e :Encoder, n :null) => {}
const addBoolean = (e :Encoder, b :boolean) => { e.addInt8(b ? 1 : 0) }
const addInt8    = (e :Encoder, s :number) => { e.addInt8(s) }
const addInt16   = (e :Encoder, s :number) => { e.addInt16(s) }
const addInt32   = (e :Encoder, s :number) => { e.addInt32(s) }
const addSize8   = (e :Encoder, s :number) => { e.addSize8(s) }
const addSize16  = (e :Encoder, s :number) => { e.addSize16(s) }
const addSize32  = (e :Encoder, s :number) => { e.addSize32(s) }
const addFloat32 = (e :Encoder, v :number) => { e.addFloat32(v) }
const addFloat64 = (e :Encoder, v :number) => { e.addFloat64(v) }
const addVarSize = (e :Encoder, v :number) => { e.addVarSize(v) }
const addVarInt  = (e :Encoder, v :number) => { e.addVarInt(v) }
const addString  = (e :Encoder, s :string) => { e.addString(s) }
const addUUID    = (e :Encoder, u :UUID) => { e.addUUID(u) }
const addData    = (e :Encoder, d :Data) => { e.addData(d) }
const addRecord  = (e :Encoder, r :Record) => { e.addRecord(r) }

const addTimestamp = (e :Encoder, s :Timestamp) => e.addFloat64(s.millis)
const addFloatArray = (e :Encoder, f :Float32Array) => { e.addFloatArray(f) }
const addByteArray = (e :Encoder, b :Uint8Array) => { e.addByteArray(b) }
const addDataArray = (enc :Encoder, arr :DataArray) => enc.addDataIterable(arr, arr.length)
const addDataSet = (enc :Encoder, set :DataSet) => enc.addDataIterable(set, set.size)
const addDataMap = (enc :Encoder, map :DataMap) => enc.addDataMap(map)

const getVoid    = (dec :Decoder) => undefined
const getNull    = (dec :Decoder) => null
const getBoolean = (dec :Decoder) => dec.getSize8() === 1
const getInt8    = (dec :Decoder) => dec.getInt8()
const getInt16   = (dec :Decoder) => dec.getInt16()
const getInt32   = (dec :Decoder) => dec.getInt32()
const getSize8   = (dec :Decoder) => dec.getSize8()
const getSize16  = (dec :Decoder) => dec.getSize16()
const getSize32  = (dec :Decoder) => dec.getSize32()
const getFloat32 = (dec :Decoder) => dec.getFloat32()
const getFloat64 = (dec :Decoder) => dec.getFloat64()
const getVarSize = (dec :Decoder) => dec.getVarSize()
const getVarInt = (dec :Decoder) => dec.getVarInt()
const getString = (dec :Decoder) => dec.getString()
const getUUID = (dec :Decoder) => dec.getUUID()
const getData = (dec :Decoder) => dec.getData()
const getRecord = (dec :Decoder) => dec.getRecord()

const getTimestamp = (dec :Decoder) => new Timestamp(getFloat64(dec))
const getFloatArray = (dec :Decoder) => dec.getFloatArray()
const getByteArray = (dec :Decoder) => dec.getByteArray()
const getDataArray = (dec :Decoder) => dec.getDataArray()
const getDataSet = (dec :Decoder) => new Set(dec.getDataArray())
const getDataMap = (dec :Decoder) => dec.getDataMap()

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
const BYTEV_ID  = 12 ; registerCodec<Uint8Array>(BYTEV_ID, addByteArray, getByteArray)

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
  else if (data instanceof Uint8Array) return BYTEV_ID
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
  private encoder? :TextEncoder
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
      // TODO: if/when ArrayBuffer.transfer is widely available, use it
      const nbuffer = new ArrayBuffer(ncapacity)
      const nbytes = new Uint8Array(nbuffer)
      nbytes.set(this.bytes)
      this.buffer = nbuffer
      this.bytes = nbytes
      this.data = new DataView(nbuffer)
    }
    this.pos = npos
    return this.data
  }

  addInt8 (s :number) { const p = this.pos ; this.prepAdd(1).setInt8(p, s) }
  addInt16 (s :number) { const p = this.pos ; this.prepAdd(2).setInt16(p, s) }
  addInt32 (s :number) { const p = this.pos ; this.prepAdd(4).setInt32(p, s) }
  addSize8 (s :number) { const p = this.pos ; this.prepAdd(1).setUint8(p, s) }
  addSize16 (s :number) { const p = this.pos ; this.prepAdd(2).setUint16(p, s) }
  addSize32 (s :number) { const p = this.pos ; this.prepAdd(4).setUint32(p, s) }
  addFloat32(v :number) { const p = this.pos ; this.prepAdd(4).setFloat32(p, v) }
  addFloat64 (v :number) { const p = this.pos ; this.prepAdd(8).setFloat64(p, v) }

  addVarSize (v :number) {
    while (true) {
      let byte = v & 0x7F
      v >>= 7
      if (v === 0) {
        this.addSize8(byte)
        return
      }
      this.addSize8(byte | 0x80)
    }
  }
  addVarInt (v :number) { this.addVarSize(v < 0 ? (-v << 1) - 1 : (v << 1)) }

  addString (text :string) {
    if (text.length === 0) {
      this.addSize16(0)
      return
    }

    // if the string is too long before encoding, it will definitely be too long after
    if (text.length > 65535) throw new Error(
      `String length cannot exceed 64k when converted to UTF-8 (length: ${text.length})`)

    const pos = this.pos, encoder = this.encoder || (this.encoder = mkTextEncoder())

    // if we don't have encodeInto then we have to encode the string into a separate byte buffer and
    // copy that byte buffer into our encoding buffer...
    if (!encoder.encodeInto) {
      const encoded = encoder.encode(text)
      if (encoded.length > 65535) throw new Error(
        `String length cannot exceed 64k when converted to UTF-8 (bytes: ${encoded.length})`)
      this.addSize16(encoded.length)
      const tpos = this.pos
      this.prepAdd(encoded.length)
      this.bytes.set(encoded, tpos)
      return
    }

    // if we do have encodeInto then we have to deal with the vagaries of not knowing how many UTF-8
    // bytes we're going to get after encoding the string; we do this in stages to avoid blowing up
    // our encoding buffer any time we write a string of non-trivial size
    const tryEncodeInto = (size :number) => {
      const tpos = this.pos
      this.prepAdd(size)
      const result = encoder.encodeInto(text, new Uint8Array(this.buffer, tpos))
      if (result.read !== text.length || !result.written) {
        this.pos = tpos
        return false
      }
      this.data.setUint16(pos, result.written)
      this.pos = tpos + result.written
      return true
    }
    // leave space for the length
    this.prepAdd(2)
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

  addUUID (uuid :UUID) {
    const p = this.pos
    this.prepAdd(16)
    try {
      uuidFromString(uuid, this.bytes, p)
    } catch (error) {
      log.warn(`${this.eid}: Unable to add UUID at ${p} (cap ${this.buffer.byteLength})`, error)
    }
  }

  addArray (data :any[], etype :ValueType) {
    this.addSize32(data.length)
    for (const elem of data) this.addValue(elem, etype)
  }

  addFloatArray (arr :Float32Array) {
    const length = arr.length
    this.addSize32(length)
    for (let ii = 0; ii < length; ii += 1) this.addFloat32(arr[ii])
  }

  addByteArray (arr :Uint8Array) {
    const length = arr.length
    this.addSize32(length)
    const tpos = this.pos
    this.prepAdd(length)
    this.bytes.set(arr, tpos)
  }

  addSet (set :ReadonlySet<any>, etype :KeyType) {
    this.addSize32(set.size)
    for (const elem of set) this.addValue(elem, etype)
  }

  addMap (map :ReadonlyMap<any, any>, ktype :KeyType, vtype :ValueType) {
    this.addSize32(map.size)
    for (const [key, value] of map.entries()) {
      this.addValue(key, ktype)
      this.addValue(value, vtype)
    }
  }

  addPath (path :Path) {
    if (path.length > 255) throw new Error(`Path too long: ${path}`)
    this.addValue(path.length, "size8")
    for (let ii = 0, ll = path.length; ii < ll; ii += 1) {
      this.addValue(path[ii], ii % 2 == 0 ? "string" : "uuid")
    }
  }

  addData (data :Data) {
    const typeId = dataTypeId(data)
    this.addSize16(typeId)
    requireEncoder(typeId)(this, data)
  }

  addDataIterable (iter :Iterable<Data>, size :number) {
    this.addSize32(size)
    if (size > 0) {
      const typeId = valuesTypeId(iter)
      const encoder = requireEncoder(typeId)
      this.addSize16(typeId)
      for (const elem of iter) encoder(this, elem)
    }
  }

  addDataMap (map :DataMap) {
    this.addSize32(map.size)
    if (map.size > 0) {
      const ktypeId = valuesTypeId(map.keys()), kencoder = requireEncoder(ktypeId)
      const vtypeId = valuesTypeId(map.values()), vencoder = requireEncoder(vtypeId)
      this.addSize16(ktypeId)
      this.addSize16(vtypeId)
      for (const [key, val] of map) {
        kencoder(this, key)
        vencoder(this, val)
      }
    }
  }

  addRecord (rec :Record) {
    const props = Object.getOwnPropertyNames(rec)
    this.addSize16(props.length)
    for (const prop of props) {
      this.addString(prop)
      this.addData(rec[prop])
    }
  }

  addValue (data :any, type :ValueType) {
    const encoder = valueCodecs[type][0]
    if (encoder) encoder(this, data)
    else throw new Error(`Unknown value type '${type}'`)
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
  private decoder? :TextDecoder
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

  getBoolean() { return this.data.getUint8(this.prepGet(1)) === 1 }
  getInt8 () { return this.data.getInt8(this.prepGet(1)) }
  getInt16 () { return this.data.getInt16(this.prepGet(2)) }
  getInt32 () { return this.data.getInt32(this.prepGet(4)) }
  getSize8 () { return this.data.getUint8(this.prepGet(1)) }
  getSize16 () { return this.data.getUint16(this.prepGet(2)) }
  getSize32 () { return this.data.getUint32(this.prepGet(4)) }
  getFloat32 () { return this.data.getFloat32(this.prepGet(4)) }
  getFloat64 () { return this.data.getFloat64(this.prepGet(8)) }

  getVarSize () {
    let size = 0
    let shift = 0
    while (true) {
      const byte = this.getSize8()
      size |= (byte & 0x7F) << shift
      if (!(byte & 0x80)) return size
      shift += 7
    }
  }
  getVarInt () {
    const size = this.getVarSize()
    return (size & 1) ? -((size + 1) >> 1) : (size >> 1)
  }

  getString () {
    const bytes = this.getSize16()
    if (bytes === 0) return ""
    const offset = this.prepGet(bytes)
    const decoder = this.decoder || (this.decoder = mkTextDecoder())
    return decoder.decode(this.source.subarray(offset, offset+bytes))
  }

  getUUID () {
    const offset = this.prepGet(16)
    return uuidToString(this.source.subarray(offset, offset+16))
  }

  getFloatArray () {
    const size = this.getSize32()
    const arr = new Float32Array(size)
    for (let ii = 0; ii < size; ii += 1) arr[ii] = this.getFloat32()
    return arr
  }

  getByteArray () {
    const size = this.getSize32()
    const pos = this.prepGet(size)
    return new Uint8Array(this.source.buffer, pos, size)
  }

  getData () {
    const typeId = this.getSize16()
    const decoder = dataDecoders.get(typeId)
    if (decoder) return decoder(this)
    throw new Error(`Unknown data type id '${typeId}'`)
  }

  getRecord () {
    const rec :Record = {}, props = this.getSize16()
    for (let ii = 0; ii < props; ii += 1) rec[this.getString()] = this.getData()
    return rec
  }

  getValue (type :ValueType) :any {
    const decoder = valueCodecs[type][1]
    if (decoder) return decoder(this)
    new Error(`Unknown value type '${type}'`)
  }

  getArray<E> (etype :ValueType) :E[] {
    const data :E[] = [], len = this.getSize32()
    for (let ii = 0; ii < len; ii += 1) data[ii] = this.getValue(etype)
    return data
  }

  getDataArray () {
    const arr :DataArray = []
    const size = this.getSize32()
    if (size > 0) {
      const decoder = requireDecoder<Data>(this.getSize16())
      for (let ii = 0; ii < size; ii += 1) arr.push(decoder(this))
    }
    return arr
  }

  getSet<E> (etype :KeyType, into :Set<E>) :Set<E> {
    const size = this.getSize32()
    for (let ii = 0; ii < size; ii += 1) into.add(this.getValue(etype))
    return into
  }

  syncSet<E> (etype :KeyType, into :SyncSet<E>) {
    const size = this.getSize32()
    const tmp = new Set<E>()
    for (let ii = 0; ii < size; ii += 1) tmp.add(this.getValue(etype))
    for (const elem of into) if (!tmp.has(elem)) into.delete(elem, true)
    for (const elem of tmp) into.add(elem, true)
    return into
  }

  getMap<K,V> (ktype :KeyType, vtype :ValueType, into :Map<K,V>) :Map<K,V> {
    const size = this.getSize32()
    for (let ii = 0; ii < size; ii += 1) into.set(this.getValue(ktype), this.getValue(vtype))
    return into
  }

  getDataMap () {
    const map :DataMap = new Map()
    const size = this.getSize32()
    if (size > 0) {
      const kdecoder = requireDecoder<DataMapKey>(this.getSize16())
      const vdecoder = requireDecoder<Data>(this.getSize16())
      for (let ii = 0; ii < size; ii += 1) map.set(kdecoder(this), vdecoder(this))
    }
    return map
  }

  syncMap<K,V> (ktype :KeyType, vtype :ValueType, into :SyncMap<K,V>) {
    const size = this.getSize32()
    const keys = [], vals :V[] = []
    for (let ii = 0; ii < size; ii += 1) {
      keys.push(this.getValue(ktype))
      vals.push(this.getValue(vtype))
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
