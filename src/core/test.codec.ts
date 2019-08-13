import {Timestamp} from "../core/util"
import {uuidv1} from "../core/uuid"
import {Encoder, Decoder, ValueType, setTextCodec} from "./codec"

import {TextEncoder, TextDecoder} from "util"
setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

// @ts-ignore: sigh jest
Object.defineProperty(global.self, 'crypto', {value: require('crypto')})

test("codec", () => {
  const enc = new Encoder()
  const vts :[any, ValueType][] = [
    [true, "boolean"],
    [false, "boolean"],
    [5, "int8"],
    [-27, "int8"],
    [2342, "int16"],
    [-3321, "int16"],
    [872342, "int32"],
    [-1213321, "int32"],
    [123.435, "float32"],
    [-123.435, "float32"],
    [123.435, "float64"],
    [-123.435, "float64"],
    [Number.MAX_VALUE, "float64"],
    [Number.MIN_VALUE, "float64"],
    ["The quick brown fox jumped over the lazy dog.", "string"],
    ["I ♥︎ math.", "string"],
    ["€∞☛✔︎", "string"],
    [uuidv1(), "uuid"],
    [Timestamp.now(), "timestamp"]
  ]

  for (const [v,t] of vts) enc.addValue(v, t)

  const msg = enc.finish()

  const dec = new Decoder(msg)
  for (const [v,t] of vts) {
    const rv = dec.getValue(t)
    // console.log(`Read ${rv} (wrote ${v})`)
    switch (t) {
    case "float32": expect(Math.abs(rv - v)).toBeLessThan(0.001) ; break
    case "float64":
    case  "number": expect(Math.abs(rv - v)).toBeLessThan(Number.EPSILON) ; break
    default       : expect(rv).toEqual(v) ; break
    }
  }
})
