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
import {Auth, AuthValidator, sessionAuth, resetAuth} from "./auth"

export const currentUser = Mutable.local<firebase.User|null>(null)

const DAY_MILLIS = 24*60*60*1000
const TOKEN_EXPIRE = 7*DAY_MILLIS
const TOKEN_USABLE = 6*DAY_MILLIS

const haveLocalStorage = typeof localStorage !== "undefined"
function readLastSession () {
  const info = (localStorage.getItem("_lastsess") || "").split(":", 3)
  return (info.length == 3) ? info : [null, null, null]
}
const [lastId, lastFBId, lastToken] = haveLocalStorage ? readLastSession() : [null, null, null]

const makeToken = (fbid :string, hash :UUID) => `${fbid}:${hash}`

async function refreshFirebaseSession (user :firebase.User) {
  const db = firebase.firestore()
  const authref = db.collection("auth").doc(user.uid)
  function setAuth (id :UUID, token :string) {
    sessionAuth.update({source: "firebase", id, token: makeToken(user.uid, token)})
    if (haveLocalStorage) localStorage.setItem("_lastsess", `${id}:${user.uid}:${token}`)
  }
  log.debug("Updating session with FB auth", "id", user.uid)
  // TODO: when we create a token immediately, it doesn't have time to propagate through the
  // Firebase datastore in time for the server to see it, so auth is rejected at first; maybe we can
  // just punt on this because this is all going to change when we have real auth
  const authdoc = await authref.get()
  if (authdoc.exists) {
    const data = authdoc.data({serverTimestamps: "estimate"}) || {}, tokens = data.tokens || {}
    // prune expired sessions
    const now = new Date().getTime(), expired = now - TOKEN_EXPIRE, usable = now - TOKEN_USABLE
    let token = "", changed = false
    try {
      for (const atoken in tokens) {
        const started = (tokens[atoken] as Timestamp).toMillis()
        if (started < expired) {
          changed = true
          delete tokens[atoken]
        }
        // reuse our last known session token if it's not expired or about to expire
        else if (started > usable && (token === "" || atoken == lastToken)) token = atoken
      }
    } catch (error) {
      log.warn("Choked checking session tokens", "tokens", tokens, error)
    }
    if (token === "") {
      token = uuidv4()
      tokens[token] = FieldValue.serverTimestamp()
      changed = true
      log.debug("Creating new session token", "token", token)
    }
    if (changed) authref.update({tokens})
    setAuth(data.id, token)
  } else {
    const id = uuidv1(), token = uuidv4()
    log.debug("Creating new id and session token", "token", token)
    authref.set({
      id,
      created: FieldValue.serverTimestamp(),
      tokens: {[token]: FieldValue.serverTimestamp()}
    }, {merge: true})
    setAuth(id, token)
  }
}

/** Listens for Firebase auth changes & creates tfw sessions based on the Firebase auth. */
export function initFirebaseAuth () {
  // if we have saved session credentials, try using them right away
  if (lastId != null && lastFBId != null && lastToken != null) {
    log.debug("Reusing session", "id", lastId, "fbid", lastFBId, "token", lastToken)
    sessionAuth.update({source: "firebase", id: lastId, token: makeToken(lastFBId, lastToken)})
  }
  firebase.auth().onAuthStateChanged(user => {
    currentUser.update(user)
    if (user) refreshFirebaseSession(user)
    else if (sessionAuth.current.source === "firebase") resetAuth()
  })
}

/** Displays a popup allowing the user to login to Firebase via Google auth provider. */
export async function showGoogleLogin () {
  var provider = new firebase.auth.GoogleAuthProvider()
  try {
    await firebase.auth().signInWithPopup(provider)
  } catch (error :any) {
    // TODO: some means of reporting auth errors?
    log.warn("Auth error", "code", error.code, "msg", error.message, "cred", error.credential)
  }
}

/** Logs the user out of Firebase and clears local session data. */
export function firebaseLogout () {
  firebase.auth().signOut()
  if (haveLocalStorage) localStorage.removeItem("_lastsess")
  if (sessionAuth.current.source === "firebase") resetAuth()
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
      const authref = this.db.collection("auth").doc(fbid)
      authref.get().then(
        doc => {
          const data = doc.data()
          if (data) {
            const tokens = Object.keys(data.tokens || {})
            if (tokens.includes(fbtoken)) disp({id, isGuest: false, isSystem: false})
            else log.warn("Invalid/missing auth token", "id", id, "fbid", fbid,
                          "token", fbtoken, "tokens", tokens)
          }
        },
        error => log.warn("Failed to resolve session doc", "id", id, error)
      )
      return NoopRemover
    })
  }
}
