const admin = require('firebase-admin')
const { send } = require('micro')
const { join } = require('path')
const { parse } = require('url')
const ms = require('ms')
const requestIp = require('request-ip')
const { NODE_ENV } = process.env
const viewColection = NODE_ENV === 'development' ? 'viewsDev' : 'views'
let seen = {}
const db = createDatabase()

function createDatabase() {
  const serviceAccount = require(join(__dirname, 'service-account.json'))

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://counts-84e16.firebaseio.com'
  })
  const database = admin.firestore()

  database.settings({
    timestampsInSnapshots: true
  })
  return database
}

async function increment(page) {
  const pageRef = db.collection(viewColection).doc(page)
  const viewsRef = db.collection(viewColection)
  const transaction = await db.runTransaction(async transaction => {
    const doc = await transaction.get(pageRef)
    if (!doc.exists) {
      viewsRef.doc(page).set({
        count: 1,
        lastVisitDate: new Date().toISOString()
      })
      return
    }
    const newDoc = {
      count: doc.data().count + 1,
      lastVisitDate: new Date().toISOString()
    }
    await transaction.update(pageRef, newDoc)
    return newDoc
  })
  return transaction
}

function verify(req) {
  setInterval(() => {
    seen = {}
  }, ms('1h'))

  if (NODE_ENV !== 'production') {
    return
  }

  const clientIp = requestIp.getClientIp(req)
  seen[clientIp] = seen[clientIp] || 0
  if (seen[clientIp] > 1000) {
    const err = new Error('Too many views per IP')
    err.statusCode = 429
    throw err
  }
  seen[clientIp] += 1
}

module.exports = async (req, res) => {
  try {
    const orig = req.headers.origin
    if (/https:\/\/(.*\.)?arnodo\.net/.test(orig)) {
      res.setHeader('Access-Control-Allow-Origin', orig)
      res.setHeader('Access-Control-Allow-Methods', 'GET')
    }

    verify(req)

    const {
      query: { page }
    } = parse(req.url, true)
    if (!page) {
      const err = new Error('Missing `page` parameter')
      err.statusCode = 400
      throw err
    }

    await increment(page)
    send(res, 200, { ok: true })
  } catch (err) {
    send(res, err.statusCode || 500, { error: err.message || 'whooops' })
  }
}
