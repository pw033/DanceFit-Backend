
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");

const app = express();
const PORT = process.env.PORT || 5000;

// Environment variables
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_SHEET_SECRET = process.env.GOOGLE_SHEET_SECRET;
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const Razorpay = require("razorpay");
const crypto = require("crypto");
const razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
});
console.log("Admin username loaded:", ADMIN_USERNAME);
console.log("Admin password loaded:", ADMIN_PASSWORD ? "YES" : "NO");
console.log("JWT secret loaded:", JWT_SECRET ? "YES" : "NO");

const GOOGLE_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyRAt6k6Voq3Wr7WuEhAPIbIy_RT1MXE4FbnIt1d2Vw-MfgRUAZzsfqTrQ2boqUNyHz/exec";

// Middleware
app.use(cors());
app.use(express.json());

// Check configuration
if (
    !ADMIN_USERNAME ||
    !ADMIN_PASSWORD ||
    !JWT_SECRET ||
    !GOOGLE_SHEET_SECRET ||
    !RAZORPAY_KEY_ID ||
    !RAZORPAY_KEY_SECRET
) {
    console.error("Missing environment variables in .env file!");
    process.exit(1);
}

// Home route
app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "Welcome to DanceFit Studio API!"
    });
});

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "DanceFit Studio backend is running!"
    });
});

app.post("/api/admin/login", (req, res) => {
    console.log("LOGIN API HIT!");

    const { username, password } = req.body || {};

    console.log("Username match:", username === ADMIN_USERNAME);
console.log("Password match:", password === ADMIN_PASSWORD);
console.log("Received username:", JSON.stringify(username));
console.log("Expected username:", JSON.stringify(ADMIN_USERNAME));

    if (
        username !== ADMIN_USERNAME ||
        password !== ADMIN_PASSWORD
    ) {
        return res.status(401).json({
            success: false,
            message: "Invalid username or password."
        });
    }

    const token = jwt.sign(
        { username, role: "admin" },
        JWT_SECRET,
        { expiresIn: "2h" }
    );

    return res.json({
        success: true,
        message: "Welcome to DanceFit Studio!",
        token
    });
});

// Admin Authentication Middleware
function verifyAdmin(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Please login first."
        });
    }

    const token = authHeader.split(" ")[1];

    try {
        req.admin = jwt.verify(token, JWT_SECRET);

        if (req.admin.role !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Admin access required."
            });
        }

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired login. Please login again."
        });
    }
}
 
      
// Create Razorpay Payment Order

app.post("/api/create-order", async (req, res) => {
    try {
        const { name, phone, email, course, plan, timing } = req.body || {};

        const prices = {
            "Basic Plan": 999,
            "Standard Plan": 2499,
            "Premium Plan": 4499
        };

        if (!name || !phone || !course || !plan) {
            return res.status(400).json({
                success: false,
                message: "Please fill all required details."
            });
        }

        if (!/^[6-9][0-9]{9}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Indian mobile number."
            });
        }

        if (!Object.prototype.hasOwnProperty.call(prices, plan)) {
            return res.status(400).json({
                success: false,
                message: "Invalid membership plan."
            });
        }

        const amount = prices[plan] * 100;

        const order = await razorpay.orders.create({
            amount,
            currency: "INR",
            receipt: "dancefit_" + Date.now(),
            notes: {
                name: name.trim(),
                phone,
                email: typeof email === "string" ? email.trim() : "",
                course: course.trim(),
                plan,
                timing: typeof timing === "string" ? timing : "Not specified"
            }
        });

        return res.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("Payment Order Error:", error);

        return res.status(500).json({
            success: false,
            message: "Could not create payment order."
        });
    }
});

// Verify Razorpay Payment

app.post("/api/verify-payment", async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body || {};

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: "Payment details are missing."
            });
        }

        // Verify payment signature
        const generatedSignature = crypto
            .createHmac("sha256", RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest("hex");

        const expected = Buffer.from(generatedSignature);
        const received = Buffer.from(razorpay_signature);

        if (
            expected.length !== received.length ||
            !crypto.timingSafeEqual(expected, received)
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment signature."
            });
        }

        // Fetch payment and order from Razorpay
        const payment = await razorpay.payments.fetch(razorpay_payment_id);
        const order = await razorpay.orders.fetch(razorpay_order_id);

        if (
            payment.order_id !== order.id ||
            payment.status !== "captured" ||
            payment.amount !== order.amount ||
            payment.currency !== "INR"
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment is not successfully captured."
            });
        }

        // Get student details from verified Razorpay order notes
        const student = order.notes || {};

        const prices = {
            "Basic Plan": 999,
            "Standard Plan": 2499,
            "Premium Plan": 4499
        };

        if (
            !student.name ||
            !student.phone ||
            !student.course ||
            !Object.prototype.hasOwnProperty.call(prices, student.plan) ||
            order.amount !== prices[student.plan] * 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid registration details."
            });
        }

        // Save verified payment and registration in Google Sheets
        const googleResponse = await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                secret: GOOGLE_SHEET_SECRET,
                name: student.name,
                phone: student.phone,
                email: student.email || "",
                course: student.course,
                plan: student.plan,
                timing: student.timing || "Not specified",
                paymentId: payment.id,
                paymentStatus: "Paid",
                paymentDate: new Date().toISOString()
            }),
            redirect: "follow"
        });

        const result = await googleResponse.json();

        if (!googleResponse.ok || !result.success) {
            throw new Error(result.message || "Google Sheets save failed.");
        }

        return res.json({
            success: true,
            message: "Payment verified and registration saved!",
            paymentStatus: "Paid",
            paymentId: payment.id
        });

    } catch (error) {
        console.error("Payment Verification Error:", error);

        return res.status(500).json({
            success: false,
            message: "Payment verification or registration failed."
        });
    }
});


// Registration API
app.post("/api/register", async (req, res) => {
    try {
        console.log("Registration API called!");
        console.log("Received Data:", req.body);
        const { name, phone, email, course, plan, timing } = req.body || {};

        if (!name || !phone || !course || !plan) {
            return res.status(400).json({
                success: false,
                message: "Please fill all required details."
            });
        }

        if (
            typeof name !== "string" ||
            typeof phone !== "string" ||
            typeof course !== "string" ||
            typeof plan !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid registration details."
            });
        }

        if (!/^[6-9][0-9]{9}$/.test(phone)) {
            return res.status(400).json({
                success: false,
                message: "Invalid Indian mobile number."
            });
        }

        const prices = {
            "Basic Plan": 999,
            "Standard Plan": 2499,
            "Premium Plan": 4499
        };

        if (!Object.prototype.hasOwnProperty.call(prices, plan)) {
            return res.status(400).json({
                success: false,
                message: "Invalid membership plan."
            });
        }

        const registrationData = {
            name: name.trim(),
            phone,
            email: typeof email === "string" ? email.trim() : "",
            course: course.trim(),
            plan,
            timing: typeof timing === "string" ? timing : "Not specified"
        };

        const googleResponse = await fetch(GOOGLE_SCRIPT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(registrationData),
            redirect: "follow"
        });

        const result = await googleResponse.json();

        if (!googleResponse.ok || !result.success) {
            throw new Error(result.message || "Google Sheets save failed.");
        }

        console.log("Registration saved:", registrationData);

        return res.status(201).json({
            success: true,
            message: "Registration saved successfully!"
        });

    } catch (error) {
    console.error("Registration Error:", error);

    return res.status(500).json({
        success: false,
        message: error.message
    });

    }
});

// Get all registrations (Admin only)
app.get("/api/admin/registrations", verifyAdmin, async (req, res) => {
    try {
        const url = `${GOOGLE_SCRIPT_URL}?secret=${encodeURIComponent(GOOGLE_SHEET_SECRET)}`;

        const googleResponse = await fetch(url, {
            method: "GET",
            redirect: "follow"
        });

        const result = await googleResponse.json();

        if (!googleResponse.ok || !result.success) {
            throw new Error(result.message || "Could not fetch registrations.");
        }

        return res.json({
            success: true,
            registrations: result.registrations
        });

    } catch (error) {
        console.error("Admin Registration Error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Could not load registrations."
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`DanceFit Studio backend running at http://localhost:${PORT}`);
});
