import {Data, DataArray, DataMap, DataMapKey, DataSet, Record, isMap, isSet} from "./data"

export type KeyType = "undefined" | "boolean" | "int8" | "int16" | "int32" | "size16" | "size32"
                    | "float32" | "float64" | "number" | "string" | "timestamp" | "id"
// TODO: support "text" value type which supported >64k of text?
export type ValueType = KeyType | "data" | "record"

//
// Encoder/decoder functions

type DataEncoder<T> = (enc :Encoder, v:T) => void
type DataDecoder<T> = (dec :Decoder) => T

const addVoid    = (e :Encoder, v :void) => {}
const addBoolean = (e :Encoder, b :boolean) => { addInt8(e, b ? 1 : 0) }
const addInt8    = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(1).setInt8(p, s) }
const addInt16   = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(2).setInt16(p, s) }
const addInt32   = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(4).setInt32(p, s) }
const addSize16  = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(2).setUint16(p, s) }
const addSize32  = (e :Encoder, s :number) => { const p = e.pos ; e.prepAdd(4).setUint32(p, s) }
const addFloat32 = (e :Encoder, v :number) => { const p = e.pos ; e.prepAdd(4).setFloat32(p, v) }
const addFloat64 = (e :Encoder, v :number) => { const p = e.pos ; e.prepAdd(8).setFloat64(p, v) }

function addString (enc :Encoder, text :string) {
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

function addDataIterable (enc :Encoder, iter :Iterable<Data>, size :number) {
  addSize32(enc, size)
  if (size > 0) {
    const typeId = valuesTypeId(iter)
    const encoder = requireEncoder(typeId)
    addSize16(enc, typeId)
    for (const elem of iter) encoder(enc, elem)
  }
}

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
const getBoolean = (dec :Decoder) => dec.data.getUint8(dec.prepGet(1)) === 1
const getInt8    = (dec :Decoder) => dec.data.getInt8(dec.prepGet(1))
const getInt16   = (dec :Decoder) => dec.data.getInt16(dec.prepGet(2))
const getInt32   = (dec :Decoder) => dec.data.getInt32(dec.prepGet(4))
const getSize16  = (dec :Decoder) => dec.data.getUint16(dec.prepGet(2))
const getSize32  = (dec :Decoder) => dec.data.getUint32(dec.prepGet(4))
const getFloat32 = (dec :Decoder) => dec.data.getFloat32(dec.prepGet(4))
const getFloat64 = (dec :Decoder) => dec.data.getFloat64(dec.prepGet(8))

function getString (dec :Decoder) {
  const bytes = getSize16(dec)
  return dec.decoder.decode(new Uint8Array(dec.buffer, dec.prepGet(bytes), bytes))
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

export function registerCodec<T> (encoder :DataEncoder<T>, decoder :DataDecoder<T>) {
  const id = dataEncoders.size
  dataEncoders.set(id, encoder)
  dataDecoders.set(id, decoder)
}

registerCodec<void>((e, v) => {}, d => undefined)
registerCodec<boolean>(addBoolean, getBoolean)
registerCodec<number>(addFloat64, getFloat64)
registerCodec<string>(addString, getString)
registerCodec<DataArray>((e, v) => addDataIterable(e, v, v.length), d => getDataArray(d))
registerCodec<DataSet>((e, v) => addDataIterable(e, v, v.size), d => new Set(getDataArray(d)))
registerCodec<DataMap>(addDataMap, getDataMap)
registerCodec<Record>(addRecord, getRecord)
registerCodec<Data>(addData, getData)

function dataTypeId (data :Data) {
  if (data === undefined) return 0
  else if (typeof data === "boolean") return 1
  else if (typeof data === "number") return 2
  else if (typeof data === "string") return 3
  else if (Array.isArray(data)) return 4
  else if (isSet(data)) return 5
  else if (isMap(data)) return 6
  else return 7 // record
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
  let id = 0
  for (const elem of iter) {
    if (id === 0) id = dataTypeId(elem)
    else if (dataTypeId(elem) !== id) return 8
  }
  return id
}

//
// General encoding/decoding APIs

const valueCodecs :{[key :string]: [DataEncoder<any>, DataDecoder<any>]} = {
  undefined: [addVoid,    getVoid],
  boolean  : [addBoolean, getBoolean],
  int8     : [addInt8,    getInt8],
  int16    : [addInt16,   getInt16],
  int32    : [addInt32,   getInt32],
  size16   : [addSize16,  getSize16],
  size32   : [addSize32,  getSize32],
  float32  : [addFloat32, getFloat32],
  float64  : [addFloat64, getFloat64],
  number   : [addFloat64, getFloat64],
  string   : [addString,  getString],
  timestamp: [addFloat64, getFloat64], // TODO
  id       : [addString,  getString], // TODO
  data     : [addData,    getData],
  record   : [addRecord,  getRecord]
}

const DefaultEncoderSize = 256
const EncoderExpandSize = 256

export class Encoder {
  buffer = new ArrayBuffer(DefaultEncoderSize)
  data = new DataView(this.buffer)
  pos = 0

  // we have to accept an optional TextEncoder to work around Jest limitations, sigh
  constructor (readonly encoder = new TextEncoder()) {}

  prepAdd (size :number) :DataView {
    const npos = this.pos + size, capacity = this.buffer.byteLength
    if (npos >= capacity) {
      let ncapacity = capacity + EncoderExpandSize
      while (ncapacity <= npos) ncapacity += EncoderExpandSize
      const nbuffer = new ArrayBuffer(ncapacity)
      new Uint8Array(nbuffer).set(new Uint8Array(this.buffer), 0)
      this.buffer = nbuffer
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

  addSet (set :ReadonlySet<any>, etype :ValueType) {
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

  finish () :Uint8Array {
    const encoded = new Uint8Array(this.buffer, 0, this.pos)
    this.pos = 0
    return encoded
  }
}

export class Decoder {
  readonly data :DataView
  pos = 0

  // we have to accept an optional TextDecoder to work around Jest limitations, sigh
  constructor (readonly buffer :ArrayBuffer, readonly decoder = new TextDecoder()) {
    this.data = new DataView(buffer)
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

  getSet<E> (etype :ValueType, into :Set<E>) :Set<E> {
    const size = getSize32(this)
    for (let ii = 0; ii < size; ii += 1) into.add(getValue(this, etype))
    return into
  }

  getMap<K,V> (ktype :KeyType, vtype :ValueType, into :Map<K,V>) :Map<K,V> {
    const size = getSize32(this)
    for (let ii = 0; ii < size; ii += 1) into.set(getValue(this, ktype), getValue(this, vtype))
    return into
  }
}