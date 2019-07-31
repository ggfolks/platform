import {ListChange, MutableList, MapChange, MutableMap} from "./rcollect"

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

test("reactive maps", () => {
  const map = MutableMap.local<string,string>()
  const hist :MapChange<string,string>[] = []
  const xhist :MapChange<string,string>[] = []
  map.onChange(change => hist.push(change))

  map.set("a", "eh")
  xhist.push({type: "set", key: "a", value: "eh", prev: undefined})
  map.set("b", "bee")
  xhist.push({type: "set", key: "b", value: "bee", prev: undefined})
  map.set("c", "sea")
  xhist.push({type: "set", key: "c", value: "sea", prev: undefined})
  expect(Array.from(map.entries())).toEqual([["a", "eh"], ["b", "bee"], ["c", "sea"]])
  expect(hist).toEqual(xhist)

  map.delete("b")
  xhist.push({type: "deleted", key: "b", prev: "bee"})
  expect(Array.from(map.entries())).toEqual([["a", "eh"], ["c", "sea"]])
  expect(hist).toEqual(xhist)

  map.set("c", "see")
  xhist.push({type: "set", key: "c", value: "see", prev: "sea"})
  expect(Array.from(map.entries())).toEqual([["a", "eh"], ["c", "see"]])
  expect(hist).toEqual(xhist)

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

  const cval = map.getValue("c")
  const chist :Array<string|undefined> = []
  cval.onValue(v => chist.push(v))
  expect(cval.current).toEqual("see")
  expect(chist).toEqual(["see"])

  map.set("c", "see")
  expect(cval.current).toEqual("see")
  expect(chist).toEqual(["see"])

  map.set("c", "cee")
  expect(cval.current).toEqual("cee")
  expect(chist).toEqual(["see", "cee"])

  map.delete("c")
  expect(cval.current).toEqual(undefined)
  expect(chist).toEqual(["see", "cee", undefined])

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
