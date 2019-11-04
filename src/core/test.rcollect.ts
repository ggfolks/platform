import {ChangeFn, Value} from "./react"
import {ListChange, MutableList, MapChange, MutableMap, MutableSet, SetChange} from "./rcollect"

test("reactive lists", () => {
  const list = MutableList.localData<string>()
  const hist :ListChange<string>[] = []
  const xhist :ListChange<string>[] = []
  list.onChange(change => hist.push(change))

  list.append("a")
  xhist.push({type: "added", elem: "a", index: 0})
  list.append("b")
  xhist.push({type: "added", elem: "b", index: 1})
  list.append("c")
  xhist.push({type: "added", elem: "c", index: 2})
  expect(list.slice()).toEqual(["a", "b", "c"])
  expect(hist).toEqual(xhist)

  list.delete(1)
  xhist.push({type: "deleted", index: 1, prev: "b"})
  expect(list.slice()).toEqual(["a", "c"])
  expect(hist).toEqual(xhist)

  list.update(1, "d")
  xhist.push({type: "updated", index: 1, elem: "d", prev: "c"})
  expect(list.slice()).toEqual(["a", "d"])
  expect(hist).toEqual(xhist)
})

function expectChange<A> (v :Value<A>, check :ChangeFn<A>) {
  const remove = v.onChange((v, ov) => { check(v, ov) ; remove() })
}

test("reactive sets", () => {
  const set = MutableSet.local<string>()
  const hist :SetChange<string>[] = []
  const xhist :SetChange<string>[] = []
  set.onChange(change => hist.push(change))

  const sizeV = set.sizeValue

  expectChange(sizeV, (s, os) => expect(os).toBe(s-1))
  set.add("a")
  xhist.push({type: "added", elem: "a"})
  expect(sizeV.current).toBe(1)
  set.add("b")
  xhist.push({type: "added", elem: "b"})
  expect(sizeV.current).toBe(2)
  set.add("c")
  xhist.push({type: "added", elem: "c"})
  expect(sizeV.current).toBe(3)
  expect(Array.from(set.values())).toEqual(["a", "b", "c"])
  expect(hist).toEqual(xhist)

  const shist :number[] = []
  sizeV.onChange(size => shist.push(size))

  expectChange(sizeV, (s, os) => expect(os).toBe(s+1))
  set.delete("b")
  xhist.push({type: "deleted", elem: "b"})
  expect(Array.from(set.values())).toEqual(["a", "c"])
  expect(hist).toEqual(xhist)
  expect(shist).toEqual([2])

  set.add("bee")
  xhist.push({type: "added", elem: "bee"})
  expect(Array.from(set.values())).toEqual(["a", "c", "bee"])
  expect(hist).toEqual(xhist)
  expect(shist).toEqual([2, 3])

  const aval = set.hasValue("a")
  const ahist :Array<boolean> = []
  aval.onValue(v => ahist.push(v))
  expect(aval.current).toEqual(true)
  expect(ahist).toEqual([true])

  expect(set.delete("a")).toEqual(true)
  expect(aval.current).toEqual(false)
  expect(ahist).toEqual([true, false])
  expect(set.delete("a")).toEqual(false)
  expect(aval.current).toEqual(false)
  expect(ahist).toEqual([true, false])
  set.add("a")
  expect(aval.current).toEqual(true)
  expect(ahist).toEqual([true, false, true])
  expect(shist).toEqual([2, 3])

  const zval = set.hasValue("z")
  const zhist :Array<boolean> = []
  zval.onValue(v => zhist.push(v))
  expect(zval.current).toEqual(false)
  expect(zhist).toEqual([false])

  set.add("z")
  expect(zval.current).toEqual(true)
  expect(zhist).toEqual([false, true])
  set.add("z")
  expect(zval.current).toEqual(true)
  expect(zhist).toEqual([false, true])
})

test("reactive maps", () => {
  const map = MutableMap.local<string,string>()
  const hist :MapChange<string,string>[] = []
  const xhist :MapChange<string,string>[] = []
  map.onChange(change => hist.push(change))

  const sizeV = map.sizeValue
  expectChange(sizeV, (s, os) => expect(os).toBe(s-1))
  map.set("a", "eh")
  xhist.push({type: "set", key: "a", value: "eh", prev: undefined})
  map.set("b", "bee")
  xhist.push({type: "set", key: "b", value: "bee", prev: undefined})
  map.set("c", "sea")
  xhist.push({type: "set", key: "c", value: "sea", prev: undefined})
  expect(Array.from(map.entries())).toEqual([["a", "eh"], ["b", "bee"], ["c", "sea"]])
  expect(hist).toEqual(xhist)

  expectChange(sizeV, (s, os) => expect(os).toBe(s+1))
  map.delete("b")
  xhist.push({type: "deleted", key: "b", prev: "bee"})
  expect(Array.from(map.entries())).toEqual([["a", "eh"], ["c", "sea"]])
  expect(hist).toEqual(xhist)

  const shist :number[] = []
  sizeV.onChange(size => shist.push(size))

  map.set("c", "see")
  xhist.push({type: "set", key: "c", value: "see", prev: "sea"})
  expect(Array.from(map.entries())).toEqual([["a", "eh"], ["c", "see"]])
  expect(hist).toEqual(xhist)
  expect(shist).toEqual([3])

  const aval = map.getValue("a")
  const ahist :Array<string|undefined> = []
  aval.onValue(v => ahist.push(v))
  expect(aval.current).toEqual("eh")
  expect(ahist).toEqual(["eh"])

  const amval = map.getMutable("a")
  const amhist :Array<string|undefined> = []
  amval.onValue(v => amhist.push(v))
  expect(amval.current).toEqual("eh")
  expect(amhist).toEqual(["eh"])
  expect(shist).toEqual([3])

  const cval = map.getValue("c")
  const chist :Array<string|undefined> = []
  cval.onValue(v => chist.push(v))
  expect(cval.current).toEqual("see")
  expect(chist).toEqual(["see"])

  map.set("c", "see")
  expect(cval.current).toEqual("see")
  expect(chist).toEqual(["see"])
  expect(shist).toEqual([3])

  map.set("c", "cee")
  expect(cval.current).toEqual("cee")
  expect(chist).toEqual(["see", "cee"])
  expect(shist).toEqual([3])

  expectChange(sizeV, (s, os) => expect(os).toBe(s+1))
  map.delete("c")
  expect(cval.current).toEqual(undefined)
  expect(chist).toEqual(["see", "cee", undefined])
  expect(shist).toEqual([3, 2])

  map.set("c", "see!")
  expect(chist).toEqual(["see", "cee", undefined, "see!"])

  // regression test for bug where we weren't testing key in projected values
  expect(aval.current).toEqual("eh")
  expect(ahist).toEqual(["eh"])
  expect(amval.current).toEqual("eh")
  expect(amhist).toEqual(["eh"])

  amval.update("aye")
  expect(map.get("a")).toEqual("aye")
  expect(amhist).toEqual(["eh", "aye"])
})

type Hooman = {name :string, age :number, weird :boolean}

test("rmap projectValue", () => {
  const map = MutableMap.local<string,Hooman>()
  const age = map.projectValue("bob", b => b.age)
  const hist :number[] = [], xhist :number[] = []
  age.onValue(age => age && hist.push(age))
  expect(age.current).toBe(undefined)

  const bob = {name: "Bob", age: 42, weird: true}
  map.set("bob", bob)
  expect(age.current).toBe(42)
  xhist.push(42)
  expect(hist).toEqual(xhist)

  map.set("bob", {...bob, age: 43})
  expect(age.current).toBe(43)
  xhist.push(43)
  expect(hist).toEqual(xhist)

  map.delete("bob")
  expect(age.current).toBe(undefined)
})

test("rmap keysValue", () => {
  const map = MutableMap.local<string,string>()
  const keyHist :string[][] = []
  const expectHist :string[][] = []
  map.keysValue.onValue(iter => keyHist.push(Array.from(iter)))
  expectHist.push([])
  expect(keyHist).toStrictEqual(expectHist)

  map.set("a", "")
  expectHist.push(["a"])
  expect(keyHist).toStrictEqual(expectHist)

  const remove1 = map.keysValue.onChange((nkeys, okeys) => {
    expect(Array.from(okeys)).toStrictEqual(["a"])
    expect(Array.from(nkeys)).toStrictEqual(["a", "b"])
    remove1()
  })
  map.set("b", "")
  expectHist.push(["a", "b"])
  expect(keyHist).toStrictEqual(expectHist)

  const remove2 = map.keysValue.onChange((nkeys, okeys) => {
    expect(Array.from(okeys)).toStrictEqual(["b", "a"]) // removed element is always last
    expect(Array.from(nkeys)).toStrictEqual(["b"])
    remove2()
  })
  map.delete("a")
  expectHist.push(["b"])
  expect(keyHist).toStrictEqual(expectHist)
})
