# KaamSetu - Complete MERN Stack Job Marketplace

A modern job marketplace connecting clients with local service workers, built with ES6 modules throughout.

## 🚀 Features

### Authentication System
- **Registration**: Email-based registration with OTP verification
- **Login**: Secure JWT-based authentication with role-based access
- **Roles**: Client (hire workers) and Worker (find jobs)
- **Auto-cleanup**: Temporary users deleted after 10 minutes if not verified

### Job Management
- **Post Jobs**: Clients can post jobs with skills, descriptions, and location
- **Browse Jobs**: Workers can find jobs matching their skills
- **Job Lifecycle**: Posted → Assigned → Active → Completed
- **OTP Completion**: Secure job completion with OTP verification
- **Reviews**: Bidirectional rating system (client ↔ worker)

### Advanced Features
- **Skill-based Matching**: Jobs matched to worker skills
- **Location Filtering**: Find jobs/workers by city
- **Urgency Flags**: Priority job posting
- **Payment Integration**: Ready for Cashfree integration
- **Real-time Updates**: Job status tracking

## 🛠 Tech Stack

### Backend
- **Node.js** with ES6 modules
- **Express.js** - Web framework
- **MongoDB** with Mongoose ODM
- **JWT** - Authentication
- **bcryptjs** - Password hashing
- **Nodemailer** - Email service
- **Cookie-parser** - Session management

### Frontend
- **React 18** - UI library
- **Vite** - Build tool
- **React Router** - Navigation
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **React Query** - Data fetching
- **React Hook Form** - Form handling

## 📁 Project Structure

```
project/
├── server/                 # Backend API (ES6 modules)
│   ├── src/
│   │   ├── controllers/    # Route handlers
│   │   │   ├── authController.js
│   │   │   └── jobController.js
│   │   ├── models/         # MongoDB schemas
│   │   │   ├── Client.js
│   │   │   ├── Worker.js
│   │   │   ├── Job.js
│   │   │   ├── OTP.js
│   │   │   └── Review.js
│   │   ├── routes/         # API routes
│   │   │   ├── auth.js
│   │   │   └── jobs.js
│   │   ├── middleware/     # Auth middleware
│   │   │   └── auth.js
│   │   ├── shared/         # Constants
│   │   │   └── constants.js
│   │   └── index.js        # Server entry point
│   ├── package.json        # Server dependencies
│   └── .env.example        # Environment template
└── client/                 # Frontend React app
    ├── src/
    │   ├── components/     # React components
    │   ├── pages/          # Page components
    │   ├── hooks/          # Custom hooks
    │   ├── store/          # State management
    │   ├── api/            # API calls
    │   └── main.jsx        # Client entry point
    ├── package.json        # Client dependencies
    └── vite.config.js      # Vite configuration
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or cloud)
- Gmail account (for OTP emails)

### 1. Clone and Setup

```bash
# Navigate to project directory
cd project

# Install server dependencies
cd server
npm install

# Install client dependencies
cd ../client
npm install
```

### 2. Environment Configuration

Create `.env` file in server directory:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/kaamsetu

# JWT Secret (generate a strong secret)
JWT_SECRET=your_super_secret_jwt_key_here_make_it_long_and_random

# Client URL
CLIENT_URL=http://localhost:3000

# Email Configuration (Gmail)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_gmail_app_password

# Frontend URL
FRONTEND_URL=http://localhost:3000
```

### 3. Gmail App Password Setup

1. Enable 2-factor authentication on your Gmail account
2. Go to Google Account settings → Security → App passwords
3. Generate an app password for "Mail"
4. Use this password in `EMAIL_PASS` (not your regular Gmail password)

### 4. Start Development Servers

**Terminal 1 - Backend:**
```bash
cd project/server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd project/client
npm run dev
```

### 5. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000
- **Health Check**: http://localhost:5000/api/health

## 📚 API Documentation

### Authentication Endpoints

#### Register User
```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "1234567890",
  "password": "password123",
  "role": "client" // or "worker"
}
```

#### Verify OTP
```http
POST /api/auth/verify-otp
Content-Type: application/json

{
  "data": "john@example.com",
  "code": "123456"
}
```

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "data": "john@example.com", // email or phone
  "password": "password123",
  "rememberMe": false
}
```

### Job Endpoints

#### Create Job (Client Only)
```http
POST /api/jobs/create
Content-Type: application/json
Cookie: token=jwt_token

{
  "title": "Fix Kitchen Sink",
  "description": "Need a plumber to fix leaking sink",
  "skill": "plumber",
  "urgency": false,
  "image": "optional_image_url"
}
```

#### Get Available Jobs (Worker Only)
```http
GET /api/jobs/available?page=1&limit=10&skill=plumber&city=Mumbai
Cookie: token=jwt_token
```

#### Accept Job (Worker Only)
```http
POST /api/jobs/:jobId/accept
Cookie: token=jwt_token
```

#### Start Job (Client Only)
```http
PUT /api/jobs/:jobId/start
Cookie: token=jwt_token
```

#### Complete Job (Client Only)
```http
POST /api/jobs/:jobId/complete
Content-Type: application/json
Cookie: token=jwt_token

{
  "otp": "123456"
}
```

## 🎯 Available Skills

The system supports these predefined skills:

- `electrician` - Electrical work
- `plumber` - Plumbing services
- `carpenter` - Carpentry work
- `painter` - Painting services
- `cleaner` - Cleaning services
- `mechanic` - Mechanical repairs
- `gardener` - Gardening services
- `cook` - Cooking services
- `driver` - Driving services
- `security-guard` - Security services

## 🔄 Job Lifecycle

1. **Posted** - Client creates job, payment processed
2. **Assigned** - Worker accepts the job
3. **Active** - Client starts job, OTP generated
4. **Completed** - Client enters OTP to complete job
5. **Rated** - Both parties can rate each other

## 🛡 Security Features

- **JWT Authentication** with HTTP-only cookies
- **Password Hashing** with bcrypt (12 rounds)
- **OTP Verification** for email confirmation
- **Role-based Access Control**
- **Input Validation** and sanitization
- **CORS Protection** with credentials
- **Auto-cleanup** of temporary/unverified users

## 🚀 Production Deployment

### Build for Production

```bash
# Build client
cd project/client
npm run build

# The built files will be in dist/ directory
```

### Environment Variables for Production

```env
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/kaamsetu
JWT_SECRET=your_production_jwt_secret_very_long_and_random
CLIENT_URL=https://yourdomain.com
EMAIL_USER=your_production_email@gmail.com
EMAIL_PASS=your_production_app_password
FRONTEND_URL=https://yourdomain.com
```

### Start Production Server

```bash
cd project/server
npm start
```

The server will automatically serve the built client files in production mode.

## 🧪 Testing the API

### Using curl

```bash
# Health check
curl http://localhost:5000/api/health

# Register user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","phone":"1234567890","password":"password123","role":"client"}'

# Login (after email verification)
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"data":"test@example.com","password":"password123"}'

# Create job (using saved cookies)
curl -X POST http://localhost:5000/api/jobs/create \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"title":"Test Job","description":"Test description","skill":"plumber"}'
```

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Error**
   - Ensure MongoDB is running locally or check cloud connection string
   - Verify network access and credentials

2. **Email OTP Not Sending**
   - Check Gmail app password (not regular password)
   - Ensure 2FA is enabled on Gmail account
   - Verify EMAIL_USER and EMAIL_PASS in .env

3. **CORS Errors**
   - Ensure CLIENT_URL matches your frontend URL exactly
   - Check that credentials: 'include' is set in frontend requests

4. **JWT Token Issues**
   - Verify JWT_SECRET is set and consistent
   - Check cookie settings (httpOnly, secure, sameSite)

5. **ES Module Errors**
   - Ensure "type": "module" is in server package.json
   - Use .js extensions in all import statements
   - Check for any remaining CommonJS syntax

### Debug Mode

Enable detailed logging:

```bash
cd project/server
DEBUG=* npm run dev
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

---

**Built with ❤️ using modern ES6 modules throughout the MERN stack**