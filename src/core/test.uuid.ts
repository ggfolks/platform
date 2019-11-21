import {UUID0, uuidv1b, uuidv4b, uuidToString, uuidFromString, setRandomSource} from "./uuid"
import * as crypto from "crypto"

setRandomSource(array => crypto.randomFillSync(Buffer.from(array.buffer)))

test("toFromString", () => {
  expect(uuidToString(uuidFromString(UUID0))).toEqual(UUID0)
  for (let ii = 0; ii < 1000; ii += 1) {
    const id = uuidv1b()
    expect(uuidFromString(uuidToString(id))).toEqual(id)
  }
  for (let ii = 0; ii < 1000; ii += 1) {
    const id = uuidv4b()
    expect(uuidFromString(uuidToString(id))).toEqual(id)
  }
})

// test("genUUIDs", () => {
//   for (let ii = 0; ii < 10; ii += 1) console.log(uuidToString(uuidv1b()))
// })
