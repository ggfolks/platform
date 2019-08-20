// UUID stuff adapted from https://github.com/kelektiv/node-uuid which is itself adapted from
// https://github.com/LiosK/UUID.js and http://docs.python.org/library/uuid.html

import {Base62} from "./basex"

const mkUUID = () => new Uint8Array(new ArrayBuffer(16))

/** A UUID stored in a length 16 native array of 8-bit unsigned bytes. */
export type UUIDB = Uint8Array

/** A UUID converted to a string via a base62 encoding. */
export type UUID = string

/** A UUID containing all zeros. */
export const UUID0 = uuidToString(mkUUID())

/** Returns `true` if `value` looks like a UUID, i.e. it is a length 16 `Uint8Array`. */
export function isUUIDB (value :any) :boolean {
  return (value instanceof Uint8Array) && (value.length == 16)
}

// if we're running on Node, load the crypto module
const isJest = typeof navigator !== "undefined" && navigator.userAgent.includes("jsdom")
const isNode = isJest || typeof global !== "undefined"
let ncrypto :any = isNode ? require("crypto") : undefined

function fillRandom (array :Uint8Array) :Uint8Array {
  // if we're on a browser with WebCrypto, use that
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(array)
  // if we're on Node, use their crypto stuff
  else if (typeof ncrypto !== "undefined") ncrypto.randomFillSync(Buffer.from(array.buffer))
  // otherwise make do with Math.random()
  else for (let ii = 0, r = 0, ll = array.length; ii < ll; ii += 1) {
    if ((ii & 0x03) === 0) r = Math.random() * 0x100000000
    array[ii] = r >>> ((ii & 0x03) << 3) & 0xff
  }
  return array
}

// randomly generated values are lazily initialized to avoid issues with blocking to await
// sufficient system entropy; see https://github.com/kelektiv/node-uuid/issues/189
let nodeId = new Uint8Array(new ArrayBuffer(6)), clockseq = 0
function lazyInit () {
  if (clockseq !== 0) return
  // obtain some random bytes
  const seed = fillRandom(new Uint8Array(new ArrayBuffer(16)))
  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  nodeId.set([seed[0] | 0x01, seed[1], seed[2], seed[3], seed[4], seed[5]])
  // Per 4.2.2, randomize (14 bit) clockseq
  clockseq = (seed[6] << 8 | seed[7]) & 0x3fff
}

let lastMSecs = 0, lastNSecs = 0

/** Creates a binary V1 UUID. See https://en.wikipedia.org/wiki/Universally_unique_identifier */
export function uuidv1b (into? :Uint8Array) :UUIDB {
  const uuid = into || mkUUID()
  lazyInit()

  // UUID timestamps are 100 nano-second units since the Gregorian epoch, (1582-10-15 00:00). JS
  // numbers aren't precise enough for this, so time is stored as 'msecs' (integer milliseconds)
  // since unix epoch (1970-01-01 00:00) and 'nsecs' (100-nanoseconds offset from msecs)
  const msecs = new Date().getTime()
  // Per 4.2.1.2, use count of UUIDs generated during the current clock cycle to simulate higher
  // resolution clock
  let nsecs = lastNSecs + 1
  // Time since last UUID creation (in msecs)
  const dt = (msecs - lastMSecs) + (nsecs - lastNSecs)/10000
  // Per 4.2.1.2, Bump clockseq on clock regression
  if (dt < 0) clockseq = clockseq + 1 & 0x3fff
  // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new time interval
  if ((dt < 0 || msecs > lastMSecs)) nsecs = 0
  // Per 4.2.1.2 Throw error if too many UUIDs are requested
  if (nsecs >= 10000) throw new Error(`Can't create more than 10M uuids/sec`)

  lastMSecs = msecs
  lastNSecs = nsecs

  // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
  const gmsecs = msecs + 12219292800000
  // `time_low`
  const tl = ((gmsecs & 0xfffffff) * 10000 + nsecs) % 0x100000000
  uuid[0] = tl >>> 24 & 0xff
  uuid[1] = tl >>> 16 & 0xff
  uuid[2] = tl >>> 8 & 0xff
  uuid[3] = tl & 0xff
  // `time_mid`
  var tmh = (gmsecs / 0x100000000 * 10000) & 0xfffffff
  uuid[4] = tmh >>> 8 & 0xff
  uuid[5] = tmh & 0xff
  // `time_high_and_version`
  uuid[6] = tmh >>> 24 & 0xf | 0x10 // include version
  uuid[7] = tmh >>> 16 & 0xff
  // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
  uuid[8] = clockseq >>> 8 | 0x80
  // `clock_seq_low`
  uuid[9] = clockseq & 0xff
  // `node`
  uuid.set(nodeId, 10)

  return uuid
}

/** Creates a binary V4 UUID. See https://en.wikipedia.org/wiki/Universally_unique_identifier */
export function uuidv4b (into? :Uint8Array) :UUIDB {
  const uuid = into || mkUUID()
  fillRandom(uuid)
  // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
  uuid[6] = (uuid[6] & 0x0F) | 0x40
  uuid[8] = (uuid[8] & 0x3F) | 0x80
  return uuid
}

/** Converts `uuid` to a base62 encoded UUID text representation. */
export function uuidToString (uuid :UUIDB) :UUID { return Base62.encode(uuid) }

/** Converts a base62 encoded text representation of a UUID (`text`) to a binary UUID.
  * @return the array supplied as `into` or the newly created UUID array. */
export function uuidFromString (text :UUID, into? :Uint8Array, offset? :number) :Uint8Array {
  if (text.length < 16 || text.length > 22) throw new Error(`Invalid encoded uuid '${text}'`)
  return Base62.decode(text, into, offset)
}

/** Creates a base62 encoded V1 UUID. See [[uuidv1b]]. */
export function uuidv1 () :UUID { return uuidToString(uuidv1b()) }

/** Creates a base62 encoded V4 UUID. See [[uuidv4b]]. */
export function uuidv4 () :UUID { return uuidToString(uuidv4b()) }
