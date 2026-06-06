import { serve } from './server.ts'
import { read as GET } from './read.ts'
import { write as POST } from './write.ts'

serve({ GET, POST })
