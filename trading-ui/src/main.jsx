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

const StrategyBuilder = lazy(() => import("./pages/StrategyBuilder"));
const Sentiment = lazy(() => import("./pages/Sentiment"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const Journal = lazy(() => import("./pages/Journal"));
const Intelligence = lazy(() => import("./pages/Intelligence"));
const Login = lazy(() => import("./pages/Login"));

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
          <Route path="/sentiment" element={<Suspense fallback={<Fallback />}><Sentiment /></Suspense>} />
          <Route path="/watchlist" element={<Suspense fallback={<Fallback />}><Watchlist /></Suspense>} />
          <Route path="/backtest" element={<Suspense fallback={<Fallback />}><StrategyBuilder /></Suspense>} />
          <Route path="/journal" element={<Suspense fallback={<Fallback />}><Journal /></Suspense>} />
          <Route path="/intelligence" element={<Suspense fallback={<Fallback />}><Intelligence /></Suspense>} />
        </Route>

        <Route path="*" element={<RouteNotFound />} />
      </Routes>
    </BrowserRouter>
  </ErrorBoundary>
);
