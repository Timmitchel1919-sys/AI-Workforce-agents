/* global require, console */
/* eslint-disable @typescript-eslint/no-require-imports */
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp({ projectId: "ai-workforce-agents" });
const db = getFirestore();

async function setAdmin() {
  const uid = "9FLaVvqhkhOs11pxgVZL8Oaj7Z12";
  const docRef = db.collection("operators").doc(uid);

  await docRef.set({
    id: uid,
    email: "sheq97@gmail.com",
    role: "admin",
    status: "active",
    allowedProjects: "*",
    emailVerified: false,
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bootstrap: true,
    revision: 1,
  });
  console.log("Super admin set successfully");
}

setAdmin().catch(console.error);
