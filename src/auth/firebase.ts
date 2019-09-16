import * as firebase from "firebase/app"
import "firebase/auth"
import "firebase/firestore"

// type ColRef = firebase.firestore.CollectionReference
// type DocRef = firebase.firestore.DocumentReference
type Timestamp = firebase.firestore.Timestamp
// const Timestamp = firebase.firestore.Timestamp
const FieldValue = firebase.firestore.FieldValue

import {NoopRemover, log} from "../core/util"
import {UUID, uuidv1, uuidv4} from "../core/uuid"
import {Mutable, Subject} from "../core/react"
import {Auth, AuthValidator, sessionAuth} from "./auth"

export const currentUser = Mutable.local<firebase.User|null>(null)

const DAY_MILLIS = 24*60*60*1000
const TOKEN_EXPIRE = 7*DAY_MILLIS
const TOKEN_USABLE = 6*DAY_MILLIS

const haveLocalStorage = typeof localStorage !== "undefined"
let lastSess = haveLocalStorage ? localStorage.getItem("_lastsess") : null

const makeToken = (fbid :string, hash :UUID) => `${fbid}:${hash}`

async function refreshFirebaseSession (user :firebase.User) {
  const db = firebase.firestore()
  const sessref = db.collection("sessions").doc(user.uid)
  const sess = await sessref.get()
  if (sess.exists) {
    const data = sess.data() || {}, tokens = data.tokens || {}
    // prune expired sessions
    const now = new Date().getTime(), expired = now - TOKEN_EXPIRE, usable = now - TOKEN_USABLE
    let token = ""
    for (const atoken of tokens) {
      const started = (tokens[atoken] as Timestamp).toMillis()
      if (started < expired) delete tokens[atoken]
      // reuse our last known session token if it's not expired or about to expire
      else if (started > usable && atoken == lastSess) token = atoken
    }
    if (token === "") {
      token = uuidv4()
      tokens[token] = FieldValue.serverTimestamp()
    }
    sessref.update({tokens})
    sessionAuth.update({source: "firebase", id: data.id, token: makeToken(user.uid, token)})
  } else {
    const id = uuidv1(), token = uuidv4()
    sessref.update({
      id,
      created: FieldValue.serverTimestamp(),
      tokens: {[token]: FieldValue.serverTimestamp()}
    })
    sessionAuth.update({source: "firebase", id, token: makeToken(user.uid, token)})
  }
}

/** Listens for Firebase auth changes & creates tfw sessions based on the Firebase auth. */
export function initFirebaseAuth () {
  firebase.auth().onAuthStateChanged(user => {
    currentUser.update(user)
    if (user) refreshFirebaseSession(user)
  })
}

/** Displays a popup allowing the user to login to Firebase via Google auth provider. */
export async function showGoogleLogin () {
  var provider = new firebase.auth.GoogleAuthProvider()
  try {
    await firebase.auth().signInWithPopup(provider)
  } catch (error) {
    // TODO: some means of reporting auth errors?
    var errorCode = error.code
    var errorMessage = error.message
    var email = error.email
    var credential = error.credential
    console.log(`Auth error ${errorCode} / ${errorMessage} / ${email} / ${credential}`)
  }
}

/** Validates client sessions using Firebase auth & session table. */
export class FirebaseAuthValidator implements AuthValidator {
  readonly db = firebase.firestore()

  validateAuth (id :UUID, token :string) :Subject<Auth> {
    return Subject.deriveSubject(disp => {
      const cidx = token.indexOf(":")
      if (cidx === -1) {
        log.warn("Invalid auth token", "id", id, "token", token)
        return NoopRemover
      }
      const fbid = token.substring(0, cidx), fbtoken = token.substring(cidx+1)
      const sessref = this.db.collection("sessions").doc(fbid)
      sessref.get().then(
        doc => {
          const data = doc.data()
          if (data) {
            const tokens = Object.keys(data.tokens || {})
            if (tokens.includes(fbtoken)) disp({id, isGuest: false, isSystem: false})
            else log.warn("Invalid/missing auth token", "id", id, "fbid", fbid, "token", token)
          }
        },
        error => log.warn("Failed to resolve session doc", "id", id, error)
      )
      return NoopRemover
    })
  }
}
