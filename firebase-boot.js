// Conecta la app con Firebase (inicio de sesión + base de datos). Solo se activa si hay configuración.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail,
  sendEmailVerification, signOut,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, collection, setDoc, deleteDoc, onSnapshot, getDoc,
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
    // Avisos de etiquetas de WhatsApp (los escribe el servidor)
    etq: (next, err) => onSnapshot(collection(db, 'waEtq'), (s) => next(s.docs.map((d) => { const x = d.data(); return { id: d.id, ids: Array.isArray(x.ids) ? x.ids : [], n: x.n || 0, at: x.at && x.at.toMillis ? x.at.toMillis() : 0 }; })), err),
    // Control de acceso: el administrador aprueba correos y asigna permisos por sección.
    acc: {
      mio: (email, next, err) => onSnapshot(doc(db, 'acceso', email), (s) => next(s.exists() ? s.data() : null), err),
      solicitud: (email, next, err) => onSnapshot(doc(db, 'solicitudes', email), (s) => next(s.exists() ? s.data() : null), err),
      solicitar: (email, data) => setDoc(doc(db, 'solicitudes', email), data),
      listaSolicitudes: (next, err) => onSnapshot(collection(db, 'solicitudes'), (s) => next(s.docs.map((d) => d.data())), err),
      listaAcceso: (next, err) => onSnapshot(collection(db, 'acceso'), (s) => next(s.docs.map((d) => d.data())), err),
      guardar: (email, data) => setDoc(doc(db, 'acceso', email), data),
      quitar: (email) => deleteDoc(doc(db, 'acceso', email)),
      quitarSolicitud: (email) => deleteDoc(doc(db, 'solicitudes', email)),
    },
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
