import {dataCopy, dataEquals} from "./data"

test("data copy", () => {
  expect(dataCopy(false)).toEqual(false)
  expect(dataCopy(5)).toEqual(5)
  expect(dataCopy("bob")).toEqual("bob")
  expect(dataCopy([1, 2, 3])).toEqual([1, 2, 3])
  expect(dataCopy(new Set([3, 2, 1]))).toEqual(new Set([3, 2, 1]))
  expect(dataCopy(new Set([[1, 2], [2, 3], [3, 4]]))).
    toEqual(      new Set([[3, 4], [1, 2], [2, 3]]))
  expect(dataCopy(new Map([["c", 3], ["b", 2], ["a", 1]]))).
    toEqual(      new Map([["c", 3], ["b", 2], ["a", 1]]))
  expect(dataCopy(new Map([["c", {c: 3}], ["b", {b: 2}], ["a", {a: 1}]]))).
    toEqual(      new Map([["c", {c: 3}], ["b", {b: 2}], ["a", {a: 1}]]))
  expect(dataCopy({a: "a", b: "b"})).toEqual({a: "a", b: "b"})
  expect(dataCopy({a: "a", b: [1, 2, 3], c: new Set(["a", "b"]), d: {e: "e", f: 42}})).
    toEqual(      {a: "a", b: [1, 2, 3], c: new Set(["a", "b"]), d: {e: "e", f: 42}})
})

test("data equality", () => {
  expect(dataEquals(false, false)).toEqual(true)
  expect(dataEquals(false, true)).toEqual(false)
  expect(dataEquals(1, 1)).toEqual(true)
  expect(dataEquals(1, 4)).toEqual(false)
  expect(dataEquals("a", "a")).toEqual(true)
  expect(dataEquals("a", "b")).toEqual(false)
  expect(dataEquals("a", 1)).toEqual(false)
  expect(dataEquals(0, false)).toEqual(false)

  expect(dataEquals([1, 2, 3], [1, 2, 3])).toEqual(true)
  expect(dataEquals([1, 2, 3], [1, 2, 4])).toEqual(false)

  expect(dataEquals(new Set([1, 2, 3]), new Set([3, 2, 1]))).toEqual(true)
  expect(dataEquals(new Set([1, 2, 3]), new Set([1, 2, 4]))).toEqual(false)

  expect(dataEquals(new Map([["a", 1], ["b", 2], ["c", 3]]),
                    new Map([["c", 3], ["b", 2], ["a", 1]]))).toEqual(true)
  expect(dataEquals(new Map([["a", 1], ["b", 2], ["c", 3]]),
                    new Map([["a", 1], ["b", 2], ["c", 4]]))).toEqual(false)

  expect(dataEquals({a: 1, b: "2", c: false}, {a: 1, b: "2", c: false})).toEqual(true)
  expect(dataEquals({a: 1, b: "2", c: false}, {a: 1, b: "3", c: false})).toEqual(false)

  expect(dataEquals({a: 1, b: "2", c: {d: 1, e: false}},
                    {a: 1, b: "2", c: {d: 1, e: false}})).toEqual(true)
  expect(dataEquals({a: 1, b: "2", c: {d: 1, e: false}},
                    {a: 1, b: "2", c: {d: 1, e: true }})).toEqual(false)

})
