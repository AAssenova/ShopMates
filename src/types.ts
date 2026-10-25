export type AppUser = {
  id: string
  email: string
  display_name: string
  role: 'user' | 'admin'
  must_change_password: boolean
}

export type ShoppingItem = {
  id: string
  family_id: string
  name: string
  quantity: number
  unit: string
  category: string
  estimated_unit_price: number | null
  note: string
  is_purchased: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export type FamilyInfo = {
  family_id: string
  family_name: string
  member_count: number
  role: 'owner' | 'member'
  members: FamilyMemberInfo[]
}

export type FamilyMemberInfo = {
  user_id: string
  display_name: string
  role: 'owner' | 'member'
}
