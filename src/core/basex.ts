// Adapted from https://github.com/cryptocoinjs/base-x
// Originally written by Mike Hearn for BitcoinJ
// Copyright (c) 2011 Google Inc
// Ported to JavaScript by Stefan Thomas
// Merged Buffer refactorings from base58-native by Stephen Pair
// Copyright (c) 2013 BitPay Inc

/** Encodes and decodes data in a given base (i.e. base64). */
interface Coder {

  /** Encodes `data` into the target base. */
  encode (data :Uint8Array) :string

  /** Decodes `encoded` from the target base.
    * @param into an optional array into which the data will be decoded. If one is not supplied a
    * new array will be created.
    * @return the array into which the data was decoded.
    * @throw Error if the encoded string contained invalid characters. */
  decode (encoded :string, into? :Uint8Array, offset? :number) :Uint8Array
}

/**
 * Creates a base-X encoder/decoder using the supplied `alphabet` string.
 * @param alphabet the characters to use for encoding numeric values. The length of the string
 * defines the base.
 */
export function makeBaseCoder (alphabet :string) :Coder {
  const BASE = alphabet.length, LEADER = alphabet[0]
  const alphaMap = new Map<string,number>()

  // pre-compute lookup table
  for (let ii = 0; ii < alphabet.length; ii += 1) {
    const x = alphabet[ii]
    if (alphaMap[x] !== undefined) throw new Error(`${x} is ambiguous`)
    alphaMap.set(x, ii)
  }

  function encode (source :Uint8Array) {
    if (source.length === 0) return ""

    let digits = [0]
    for (let ii = 0; ii < source.length; ii += 1) {
      let carry = source[ii]
      for (let jj = 0; jj < digits.length; jj += 1) {
        carry += digits[jj] << 8
        digits[jj] = carry % BASE
        carry = (carry / BASE) | 0
      }
      while (carry > 0) {
        digits.push(carry % BASE)
        carry = (carry / BASE) | 0
      }
    }

    let encoded = ""
    // deal with leading zeros
    for (let kk = 0; source[kk] === 0 && kk < source.length-1; kk += 1) encoded += LEADER
    // convert digits to a string
    for (let qq = digits.length-1; qq >= 0; qq -= 1) encoded += alphabet[digits[qq]]
    return encoded
  }

  function decode (encoded :string, into? :Uint8Array, offset? :number) {
    if (encoded.length === 0) return new Uint8Array(new ArrayBuffer(0))

    let bytes = [0]
    for (let ii = 0, ll = encoded.length; ii < ll; ii += 1) {
      let value = alphaMap.get(encoded[ii])
      if (value === undefined) throw new Error(`Invalid character at ${ii} in '${encoded}'`)

      let carry = value
      for (let jj = 0, ll = bytes.length; jj < ll; jj += 1) {
        carry += bytes[jj] * BASE
        bytes[jj] = carry & 0xff
        carry >>= 8
      }
      while (carry > 0) {
        bytes.push(carry & 0xff)
        carry >>= 8
      }
    }

    // deal with leading zeros
    for (let kk = 0; encoded[kk] === LEADER && kk < encoded.length-1; kk += 1) bytes.push(0)

    if (!into) return Uint8Array.from(bytes.reverse())
    into.set(bytes.reverse(), offset)
    return into
  }

  return {encode, decode}
}

/** An encoder/decoder created for base62 strings, using the 'standard' alphabet. */
export const Base62 = makeBaseCoder(
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')
