import {ID, Domain, EntityEvent, FlatValueComponent} from "./entity"

function mkEv<T> (type :T, id :ID) { return {type, id} }

const EmptyConfig = {components: {}}

test("entity lifecycle events", () => {
  const domain = new Domain(EmptyConfig)
  const history :EntityEvent[] = []
  domain.events.onEmit(ev => history.push(ev))
  const exhist :EntityEvent[] = []

  const id0 = domain.add(EmptyConfig, true)
  exhist.push(mkEv("added", id0), mkEv("enabled", id0))
  expect(history).toEqual(exhist)
  domain.delete(id0)
  exhist.push(mkEv("disabled", id0), mkEv("deleted", id0))
  expect(history).toEqual(exhist)

  const id1 = domain.add(EmptyConfig, false)
  exhist.push(mkEv("added", id1))
  expect(history).toEqual(exhist)
  domain.delete(id1)
  exhist.push(mkEv("deleted", id1))
  expect(history).toEqual(exhist)

  const id2 = domain.add(EmptyConfig, false)
  exhist.push(mkEv("added", id2))
  expect(history).toEqual(exhist)
  domain.enable(id2)
  exhist.push(mkEv("enabled", id2))
  expect(history).toEqual(exhist)
  domain.delete(id2)
  exhist.push(mkEv("disabled", id2), mkEv("deleted", id2))
  expect(history).toEqual(exhist)
})

test("entity id reuse", () => {
  const domain = new Domain(EmptyConfig)

  const ids = []
  for (let ii = 0; ii < 100; ii += 1) ids.push(domain.add(EmptyConfig))
  for (let ii = 0; ii < 100; ii += 2) domain.delete(ids[ii])
  for (let ii = 0; ii < 100; ii += 2) expect(domain.add(EmptyConfig)).toEqual(ids[ii])
})

test("flat value component", () => {
  const DefaultName = "default"
  const name = new FlatValueComponent<string>("name", DefaultName)
  const age = new FlatValueComponent<number|undefined>("age", 0)
  const domain = new Domain({components: {name, age}})

  const id0 = domain.add({components: {name: {}}})
  expect(name.read(id0)).toEqual(DefaultName)
  name.update(id0, "foo")
  expect(name.read(id0)).toEqual("foo")

  const id1 = domain.add({components: {name: {initial: "bar"}}})
  expect(name.read(id1)).toEqual("bar")
  name.update(id1, "baz")
  expect(name.read(id1)).toEqual("baz")

  const id2 = domain.add({components: {age: {initial: 1}}})
  expect(age.read(id2)).toEqual(1)

  const id3 = domain.add({components: {age: {initial: undefined}}})
  expect(age.read(id3)).toBe(undefined)
})
