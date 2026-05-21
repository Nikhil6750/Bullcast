// src/main.jsx
import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import {
  getCurrentSupabaseSession,
  onSupabaseAuthStateChange,
} from "./services/supabaseStorage";
import { hasEnteredLocalDemo } from "./services/entryState";
import "./global.css";
import "./index.css";

const News = lazy(() => import("./pages/News"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Journal = lazy(() => import("./pages/Journal"));
const Intelligence = lazy(() => import("./pages/Intelligence"));
const Login = lazy(() => import("./pages/Login"));
const Backtest = lazy(() => import("./pages/Backtest"));
const LiveMonitor = lazy(() => import("./pages/LiveMonitor"));

const RouteNotFound = () => (
  <div className="p-6 text-white">
    <h2 className="text-xl mb-2">Route not found</h2>
    <div className="text-neutral">The requested page does not exist.</div>
  </div>
);

const Fallback = () => <div className="p-6 text-neutral">Loading...</div>;

function useEntryState() {
  const [state, setState] = useState({
    ready: false,
    authenticated: false,
    localDemo: hasEnteredLocalDemo(),
  });

  useEffect(() => {
    let active = true;

    const refresh = (session) => {
      if (!active) return;
      setState({
        ready: true,
        authenticated: Boolean(session?.user),
        localDemo: hasEnteredLocalDemo(),
      });
    };

    getCurrentSupabaseSession().then(refresh);
    const unsubscribe = onSupabaseAuthStateChange((_event, session) => {
      refresh(session);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}

function EntryRoute() {
  const entry = useEntryState();

  if (!entry.ready) return <Fallback />;
  if (entry.authenticated || entry.localDemo) {
    return <Navigate to="/journal" replace />;
  }

  return (
    <Suspense fallback={<Fallback />}>
      <Login />
    </Suspense>
  );
}

function RequireEntry() {
  const entry = useEntryState();

  if (!entry.ready) return <Fallback />;
  if (!entry.authenticated && !entry.localDemo) {
    return <Navigate to="/login" replace />;
  }

  return <App />;
}

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EntryRoute />} />
        <Route path="/login" element={<Suspense fallback={<Fallback />}><Login /></Suspense>} />

        <Route element={<RequireEntry />}>
          <Route path="/news" element={<Suspense fallback={<Fallback />}><News /></Suspense>} />
          <Route path="/watchlist" element={<Suspense fallback={<Fallback />}><Watchlist /></Suspense>} />
          <Route path="/journal" element={<Suspense fallback={<Fallback />}><Journal /></Suspense>} />
          <Route path="/intelligence" element={<Suspense fallback={<Fallback />}><Intelligence /></Suspense>} />
          <Route path="/backtest" element={<Suspense fallback={<Fallback />}><Backtest /></Suspense>} />
          <Route path="/live-monitor" element={<Suspense fallback={<Fallback />}><LiveMonitor /></Suspense>} />
        </Route>

        <Route path="*" element={<RouteNotFound />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
);
