import React, { createContext, useContext, useEffect, useState } from 'react';
import { DbClient } from '@fresh/core/db';
import { NativeSqliteDriver } from '../db/driver';

const DbContext = createContext<DbClient | null>(null);

export function useDb(): DbClient {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb must be used within DbProvider');
  return ctx;
}

export function DbProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DbClient | null>(null);

  useEffect(() => {
    NativeSqliteDriver.create()
      .then((driver) => setDb(new DbClient(driver)))
      .catch(console.error);
  }, []);

  if (!db) return null;

  return <DbContext.Provider value={db}>{children}</DbContext.Provider>;
}
