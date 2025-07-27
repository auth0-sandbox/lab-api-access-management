// Acme: app.js
// Lab: API Access Management
//

import cookieParser from 'cookie-parser'
import express from 'express'
import session from 'express-session'
import createError from 'http-errors'
import logger from 'morgan'
import path, { dirname, normalize } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import auth0Express from 'express-openid-connect'

const { auth, requiresAuth } = auth0Express

dotenv.config()

// Calculate the app URL if not set externally
if (!process.env.BASE_URL) {
    process.env.BASE_URL = !process.env.CODESPACE_NAME
        ? `http://localhost:${process.env.PORT}`
        : `https://${process.env.CODESPACE_NAME}-${process.env.PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
}

// Create Express
const app = express()

// Assuming this file is in the src directory, find the project directory
const __filename = fileURLToPath(import.meta.url)
const __fileDirectory = dirname(__filename)
const __dirname = normalize(path.join(__fileDirectory, ".."))
app.set("views", path.join(__dirname, "views"))
app.set("view engine", "pug")

app.use(logger("combined"))

// Accept both JSON and URL-encoded bodies, and parse cookies
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
app.use(cookieParser())

// Serve the static files in the public directory
app.use(express.static(path.join(__dirname, "public")))

// Use sessions
app.use(
    session({
        secret: process.env.SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: false,
            sameSite: 'lax',
            secure: false
        }
    })
)

app.use(
    auth({
        issuerBaseURL: process.env.ISSUER_BASE_URL,
        baseURL: process.env.BASE_URL,
        clientID: process.env.CLIENT_ID,
        clientSecret: process.env.CLIENT_SECRET,
        secret: process.env.SECRET,
        idpLogout: true,
        authRequired: false,
        authorizationParams: {
            response_type: "code",
            audience: process.env.BACKEND_AUDIENCE,
            scope: "openid profile email offline_access read:current_user_expenses"
        },
        routes: {
            login: false
        }
    })
)

async function fetchProtectedResource(req, url, method, body, headers) {
    if (!req.oidc || !req.oidc.accessToken) {
        throw new Error("User does not have an access token");
    }
    const options = {
        method: method || "GET",
        body: body ? JSON.stringify(body) : null,
        headers: new Headers({
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${req.oidc.accessToken.access_token}`,
            ...headers,
        }),
    }
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(`Error from fetch: ${response.statusText}`)
    }
    return response;
}

// Set up the middleware for the route paths

// Override the default login endpoint
app.get("/login", (req, res) => {
    res.oidc.login({
        returnTo: req.query.returnTo || "/"
    })
})

// Landing page - show totals if the user is authenticated
app.get("/", async (req, res) => {
    let locals = {
        path: req.path,
        user: req.oidc && req.oidc.user,
        total: null,
        count: null
    }
    try {
        if (locals.user) {
            const apiUrl = `${process.env.BACKEND_URL}/expenses`
            const response = await fetchProtectedResource(req, apiUrl)
            const expenses = await response.json()
            locals.total = expenses.reduce((accum, expense) => accum + expense.value, 0)
            locals.count = expenses.length
        }
    } catch (error) {
        console.error(error)
    }
    res.render("home", locals)
})

// Show expenses, requires authentication
app.get("/expenses", async (req, res) => {
    let locals = {
        path: req.path,
        user: req.oidc && req.oidc.user,
        expenses: null
    }
    try {
        if (locals.user) {
            const apiUrl = `${process.env.BACKEND_URL}/expenses`
            const response = await fetchProtectedResource(req, apiUrl)
            const expenses = await response.json()
            locals.expenses = expenses
        }
    } catch (error) {
        console.error(error)
    }
    res.render("expenses", locals)
})

// Show tokens, requires authorization
app.get("/tokens", async (req, res) => {
    res.render("tokens", {
        path: req.path,
        user: req.oidc && req.oidc.user,
        id_token: req.oidc && req.oidc.idToken,
        access_token: req.oidc && req.oidc.accessToken,
        refresh_token: req.oidc && req.oidc.refreshToken,
    })
})

// Show userinfo, requires authorization
app.get("/userinfo", async (req, res) => {
    const locals = {
        path: req.path,
        user: req.oidc && req.oidc.user,
        userinfo: null
    }
    try {
        if (locals.user) {
            const apiUrl = `${process.env.ISSUER_BASE_URL}/userinfo`
            const response = await fetchProtectedResource(req, apiUrl)
            locals.userinfo = await response.json()
        }
    } catch (error) {
        console.error(error)
    }
    res.render("userinfo", locals)
})

// Catch 404 and forward to error handler
app.use((req, res, next) => next(createError(404)))

// Error handler
app.use((err, req, res, next) => {
    res.locals.message = err.message
    res.locals.error = err
    res.status(err.status || 500)
    res.render("error", {
        user: req.oidc && req.oidc.user,
    })
})

app.listen(process.env.PORT, () => {
    console.log(`WEB APP: ${process.env.BASE_URL}`)
})