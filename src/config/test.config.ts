import {inheritMerge} from "./config"

test("config inheritance", () => {
  // top-level record merging
  expect(inheritMerge([
    {child:  true, a: "a", uno: 1},
    {parent: true, b: "b", dos: 2},
    {grand:  true, c: "c", tre: 3}
  ])).toEqual(
    {child: true, parent: true, grand: true, a: "a", b: "b", c: "c", uno: 1, dos: 2, tre: 3})

  // sub-record merging
  expect(inheritMerge([
    {child:  true, sub: {a: 1}},
    {parent: true, sub: {b: 2}},
    {grand:  true, sub: {c: 3}}
  ])).toEqual(
    {child: true, parent: true, grand: true, sub: {a: 1, b:2, c:3}})

  // property overrides
  expect(inheritMerge([
    {child: true,    sub: {a: 1}},
    {name: "parent", sub: {a: 2}},
    {name: "grand",  sub: {c: 3}}
  ])).toEqual(
    {child: true, name: "parent", sub: {a: 1, c: 3}})

  // set merging
  expect(inheritMerge([
    {set: new Set(["a"]), sub: {set: new Set([1])}},
    {set: new Set(["b"]), sub: {set: new Set([2])}},
    {set: new Set(["c"]), sub: {set: new Set([3])}}
  ])).toEqual(
    // NOTE: we rely here on implementation details of set merging, but JavaScript has no sane set
    // equality test, certainly not built into Jest; so we have no great alternatives
    {set: new Set(["c", "b", "a"]), sub: {set: new Set([3, 2, 1])}})

  // array overriding (arrays don't merge)
  expect(inheritMerge([
    {lets: ["a"], sub: {nums: [1]}},
    {lets: ["b"], sub: {nums: [2]}},
    {lets: ["c"], sub: {nums: [3]}}
  ])).toEqual(
    {lets: ["a"], sub: {nums: [1]}})
})
