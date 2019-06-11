import {Record} from "./data"
import * as R from "./react"
import {makeConfig, resolveConfig} from "./config"

test("config inheritance", () => {
  // top-level record merging
  expect(makeConfig([
    {child:  true, a: "a", uno: 1},
    {parent: true, b: "b", dos: 2},
    {grand:  true, c: "c", tre: 3}
  ])).toEqual(
    {child: true, parent: true, grand: true, a: "a", b: "b", c: "c", uno: 1, dos: 2, tre: 3})

  // sub-record merging
  expect(makeConfig([
    {child:  true, sub: {a: 1}},
    {parent: true, sub: {b: 2}},
    {grand:  true, sub: {c: 3}}
  ])).toEqual(
    {child: true, parent: true, grand: true, sub: {a: 1, b:2, c:3}})

  // property overrides
  expect(makeConfig([
    {child: true,    sub: {a: 1}},
    {name: "parent", sub: {a: 2}},
    {name: "grand",  sub: {c: 3}}
  ])).toEqual(
    {child: true, name: "parent", sub: {a: 1, c: 3}})

  // set merging
  expect(makeConfig([
    {set: new Set(["a"]), sub: {set: new Set([1])}},
    {set: new Set(["b"]), sub: {set: new Set([2])}},
    {set: new Set(["c"]), sub: {set: new Set([3])}}
  ])).toEqual(
    {set: new Set(["a", "b", "c"]), sub: {set: new Set([1, 2, 3])}})

  // map merging
  expect(makeConfig([
    {set: new Map([["a", 1], ["d", 4]]), sub: {set: new Map([[1, "a"]])}},
    {set: new Map([["b", 2], ["d", 3]]), sub: {set: new Map([[2, "b"]])}},
    {set: new Map([["c", 3], ["d", 2]]), sub: {set: new Map([[3, "c"]])}}
  ])).toEqual(
    {set: new Map([["c", 3], ["b", 2], ["a", 1], ["d", 4]]), sub: {
      set: new Map([[3, "c"], [2, "b"], [1, "a"]])}})

  // array overriding (arrays don't merge)
  expect(makeConfig([
    {lets: ["a"], sub: {nums: [1]}},
    {lets: ["b"], sub: {nums: [2]}},
    {lets: ["c"], sub: {nums: [3]}}
  ])).toEqual(
    {lets: ["a"], sub: {nums: [1]}})
})

test("config resolution", () => {
  const cfgA = {name: "a", prototype: "b", a: "a"}, cfgAV = R.mutableOpt<Record>(cfgA)
  const cfgB = {name: "b", prototype: "c", b: "b"}, cfgBV = R.mutableOpt<Record>(undefined)
  const cfgC = {name: "c", c: "c"},                 cfgCV = R.mutableOpt<Record>(undefined)
  const cfgD = {name: "d", d: "d"},                 cfgDV = R.mutableOpt<Record>(cfgD)

  const source = {
    load: (path :String) => {
      switch (path) {
      case "a": return cfgAV
      case "b": return cfgBV
      case "c": return cfgCV
      case "d": return cfgDV
      default:  return R.constantOpt<Record>(undefined)
      }
    }
  }

  const expectA = {name: "a", prototype: "b", a: "a", b: "b", c: "c"}
  expect(makeConfig([cfgA, cfgB, cfgC])).toEqual(expectA)

  const cfgHistory :Array<Record|undefined> = []
  const cfgV = resolveConfig(source, "a")
  cfgV.onValue(cfg => cfgHistory.push(cfg))
  expect(cfgHistory).toEqual([undefined])

  cfgBV.update(cfgB)
  expect(cfgHistory).toEqual([undefined])
  cfgCV.update(cfgC)
  expect(cfgHistory).toEqual([undefined, expectA])

  cfgAV.update({name: "a", prototype: "d", a: "a"})
  const expectD = {name: "a", prototype: "d", a: "a", d: "d"}
  expect(cfgHistory).toEqual([undefined, expectA, expectD])
})
