// Import necessary firebase modules
const admin = require("firebase-admin");

const { getFirestore } = require("firebase-admin/firestore");

// Initialize the Firebase Admin SDK
const serviceAccount = require("./key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://chat-room-aa6d6.firebaseio.com",
  storageBucket: "chat-room-aa6d6.appspot.com",
});
const db = getFirestore();

const express = require("express");
const ph = require("password-hash");
const bp = require("body-parser");
const http = require("http");
const socketIo = require("socket.io");
const multer = require("multer");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(bp.json());

// Set up multer for handling file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

//route for call Intro Page
app.get("/", (req, res) => {
  res.render("chatroomIntro");
});

//route for call signup form
app.get("/register", (req, res) => {
  res.render("Register.ejs", { errstate: false, succstate: false });
});

//route for handling user signup
app.post("/registersubmit", upload.single("image"), async (req, res) => {
  try {
    let imgErrMsg = null;
    //checking picture is uploaded or not
    if (!req.file) {
      imgErrMsg = "Please add profile picture..!";
    } else {
      const { name, email, psw, c_psw } = req.body;

      //checking password is matched or not
      if (psw != c_psw) {
        res.render("Register", {
          succstate: false,
          errstate: true,
          errmessage: "Password doesn't match",
        });
      } else {
        // Create the user in Firebase Authentication
        const userRecord = await admin.auth().createUser({
          email: email,
          password: psw,
          displayName: name,
        });

        // Upload the image to Firebase Storage
        const bucket = admin.storage().bucket();
        const imageBuffer = req.file.buffer;
        const imageName = `${userRecord.uid}.jpg`;
        const imageFile = bucket.file(imageName);
        await imageFile.save(imageBuffer, {
          metadata: {
            contentType: "image/jpeg",
          },
        });
        // Get the image URL
        const imageUrl = await imageFile.getSignedUrl({
          action: "read",
          expires: "12-31-2023",
        });

        //save user data to Firestore
        db.collection("users")
          .doc(userRecord.uid)
          .set({
            name: req.body.name,
            email: req.body.email,
            password: ph.generate(req.body.psw),
            imageurl: imageUrl[0],
            userID: userRecord.uid,
            time: new Date(),
          })
          .then(() => {
            res.render("Register", {
              succstate: true,
              errstate: false,
              message: "SignUp Successful..! Please Login",
            });
          });
      }
    }
    if (imgErrMsg) {
      res.render("Register", {
        errstate: true,
        succstate: false,
        errmessage: imgErrMsg,
      });
    }
  } catch (error) {
    if (error.code === "auth/email-already-exists") {
      res.render("Register", {
        succstate: false,
        errstate: true,
        errmessage: "User already exists.!",
      });
    } else if (error.code === "auth/invalid-email") {
      res.render("Register", {
        succstate: false,
        errstate: true,
        errmessage: "Invalid email.!",
      });
    } else if (error.code === "auth/invalid-password") {
      res.render("Register", {
        succstate: false,
        errstate: true,
        errmessage: "Password must be 6 characters",
      });
    }
    // console.error("Error registering user:", error);
  }
});

//route for call signIn from
app.get("/login", (req, res) => {
  res.render("Login", { errstate: false });
});

//route for handling user signin
app.post("/loginSubmit", async (req, res) => {
  try {
    const { email, psw } = req.body;

    const usersRef = db.collection("users");
    const userdocs = await usersRef.where("email", "==", email).get();

    if (userdocs.empty) {
      // User not found
      res.render("Login", {
        errstate: true,
        errMessage: "User does't exist..!",
      });
    } else {
      const userData = userdocs.docs[0].data();
      if (!ph.verify(psw, userData.password)) {
        // Incorrect password
        res.render("Login", {
          errstate: true,
          errMessage: "Incorrect password..!",
        });
      } else {
        // Successful login
        res.render("chatroomHome", {
          data: userData,
          errstate: false,
        });
      }
    }
  } catch (error) {
    console.error("Error registering user:", error);
  }
});

//######### After login

const rooms = {};

app.get("/chatroom", (req, res) => {
  res.render("chatroom");
});

io.on("connection", (socket) => {
  socket.on("createRoom", (roomCode, userName, dpUrl) => {
    if (rooms[roomCode]) {
      socket.emit("roomExistsError", "Room already exists");
      return;
    }
    if (!rooms[roomCode]) {
      rooms[roomCode] = [];
    }
    rooms[roomCode].push(userName);
    socket.join(roomCode);
    console.log(`${userName} created a room and joined room is: ${roomCode}`);
    socket.emit("redirectToChatroom", roomCode, userName);

    db.collection("liveRooms")
      .doc(roomCode)
      .set({
        users: admin.firestore.FieldValue.arrayUnion(userName),
        userprofile: admin.firestore.FieldValue.arrayUnion(dpUrl),
      });
    db.collection("rooms")
      .doc(roomCode)
      .set({
        users: admin.firestore.FieldValue.arrayUnion(userName),
      });
    db.collection("rooms")
      .doc(roomCode)
      .collection("roomChat")
      .doc(roomCode)
      .set({
        messages: null,
      });
  });

  socket.on("joinRoom", (roomCode, userName, dpUrl) => {
    if (rooms[roomCode]) {
      rooms[roomCode].push(userName);
      socket.join(roomCode);
      console.log(`${userName} joined room: ${roomCode}`);
      socket.emit("redirectToChatroom", roomCode, userName);
      console.log(rooms);

      db.collection("liveRooms")
        .doc(roomCode)
        .update({
          users: admin.firestore.FieldValue.arrayUnion(userName),
          userprofile: admin.firestore.FieldValue.arrayUnion(dpUrl),
        });

      db.collection("rooms")
        .doc(roomCode)
        .update({
          users: admin.firestore.FieldValue.arrayUnion(userName),
        });
    } else {
      socket.emit("roomNotFound");
    }
  });

  socket.on("newUser", (username, roomCode) => {
    io.emit("updateUser", username, roomCode);
  });

  socket.on("userJoined", (username, roomCode) => {
    const doc = db.collection("liveRooms").doc(roomCode);
    doc.onSnapshot((docSnapshot) => {
      io.emit(
        "userList",
        docSnapshot.data().users,
        docSnapshot.data().userprofile,
        roomCode
      );
    });
  });

  socket.on("sendMessage", (msg) => {
    const senderRoomCode = msg.roomCode;
    if (rooms[senderRoomCode]) {
      const roomMembers = rooms[senderRoomCode];
      console.log(senderRoomCode + " : " + msg.name + " : " + msg.message);
      var chat = msg.name + " : " + msg.message;
      db.collection("rooms")
        .doc(senderRoomCode)
        .collection("roomChat")
        .doc(senderRoomCode)
        .update({
          messages: admin.firestore.FieldValue.arrayUnion(chat),
        });
      if (roomMembers) {
        io.emit("receivedMessage", {
          message: msg.message,
          sender: socket.id,
          roomCode: senderRoomCode,
          senderName: msg.name,
        });
      }
    }
  });

  socket.on("exitRoom", (username, roomcode, dpUrl) => {
    if (rooms.hasOwnProperty(roomcode)) {
      rooms[roomcode] = rooms[roomcode].filter((name) => name !== username);
    }

    for (const key in rooms) {
      if (rooms[key].length === 0) {
        delete rooms[key];
      }
    }

    io.emit("exitUser", username, roomcode);

    const doc = db.collection("liveRooms").doc(roomcode);
    doc.update({
      users: admin.firestore.FieldValue.arrayRemove(username),
      userprofile: admin.firestore.FieldValue.arrayRemove(dpUrl),
    });

    console.log(username + " is disconnected");
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
