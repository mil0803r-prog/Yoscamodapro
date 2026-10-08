// Conecta la app con Firebase (inicio de sesión + base de datos). Solo se activa si hay configuración.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, collection, setDoc, deleteDoc, onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const cfg = window.YOSCA_FIREBASE;
if (cfg && cfg.apiKey) {
  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const google = () => {
    const prov = new GoogleAuthProvider();
    return signInWithPopup(auth, prov).catch((e) => {
      // Algunos navegadores de celular bloquean la ventana emergente: se usa redirección.
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return signInWithRedirect(auth, prov);
      throw e;
    });
  };
  window.YoscaFB = {
    onUser: (cb) => onAuthStateChanged(auth, cb),
    google,
    signUp: (e, p) => createUserWithEmailAndPassword(auth, e, p),
    signIn: (e, p) => signInWithEmailAndPassword(auth, e, p),
    reset: (e) => sendPasswordResetEmail(auth, e),
    verify: () => (auth.currentUser ? sendEmailVerification(auth.currentUser) : Promise.resolve()),
    out: () => signOut(auth),
    idToken: () => (auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve('')),
    // Los datos de cada persona viven en users/{uid}/...
    store: (uid) => ({
      colSnap: (name, next, err) => onSnapshot(collection(db, 'users', uid, name), (s) => next(s.docs.map((d) => d.data())), err),
      docSnap: (path, next, err) => onSnapshot(doc(db, 'users', uid, ...path.split('/')), (s) => next(s.exists() ? s.data() : null), err),
      set: (name, id, data) => setDoc(doc(db, 'users', uid, name, id), data),
      del: (name, id) => deleteDoc(doc(db, 'users', uid, name, id)),
      setDoc: (path, data) => setDoc(doc(db, 'users', uid, ...path.split('/')), data),
    }),
  };
}
window.dispatchEvent(new Event('yosca-fb'));
