import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  // UI-level gate only — the real enforcement is in the database's RLS
  // delete policies, which check the same profiles.is_admin flag
  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) {
      setIsAdmin(false)
      return
    }
    supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userId)
      .single()
      .then(({ data }) => setIsAdmin(data?.is_admin ?? false))
  }, [session?.user?.id])

  return {
    session,
    user: session?.user ?? null,
    isAdmin,
    loading,
    signOut: () => supabase.auth.signOut(),
  }
}
