import { auth } from '@/lib/auth' // Get the internal adapter instance

async function createUsers(numberOfUsers: number) {
  for (let i = 1; i <= numberOfUsers; i++) {
    try {
      // Create the new user using the adapter directly
      const newUser = await auth.api.createUser({
        body: {
          email: `user${i}@example.com`, // required
          password: `user.${i}`, // required
          name: `User ${i}`, // required
          role: 'user',
          data: { username: `user.${i}` },
        },
      })
      console.log(`User ${i} created:`, newUser.user.email)
    } catch (error) {
      console.error('Error creating user:', error)
    }
  }
}

createUsers(41)
