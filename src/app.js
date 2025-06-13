const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
require("dotenv").config();
const { Server } = require("socket.io");
const { TeacherLogin } = require("./controllers/login");
const {
  createPoll,
  voteOnOption,
  getPolls,
} = require("../src/controllers/poll");

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;

const DB =
  process.env.NODE_ENV === "production"
    ? process.env.MONGODB_URL
    : "mongodb://localhost:27017/intevuePoll";

mongoose
  .connect(DB)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((e) => {
    console.error("Failed to connect to MongoDB:", e);
  });

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

let votes = {};
let connectedUsers = {};

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Log all connected clients
  console.log("Total connected clients:", io.engine.clientsCount);
  console.log("Connected socket IDs:", Array.from(io.sockets.sockets.keys()));

  socket.on("createPoll", async (pollData) => {
    try {
      console.log("Received createPoll event from socket:", socket.id);
      console.log("Poll data:", JSON.stringify(pollData, null, 2));

      votes = {};
      const poll = await createPoll(pollData);
      console.log("Created poll in database:", JSON.stringify(poll, null, 2));

      // Broadcast to all connected clients
      const pollDataToEmit = {
        _id: poll._id,
        question: poll.question,
        options: poll.options.map((opt) => ({
          id: opt.id,
          text: opt.text,
          correct: opt.correct,
        })),
        timer: poll.timer,
        teacherUsername: poll.teacherUsername,
      };

      console.log(
        "Emitting pollCreated event with data:",
        JSON.stringify(pollDataToEmit, null, 2)
      );
      io.emit("pollCreated", pollDataToEmit);
      console.log("Emitted pollCreated event to all clients");

      // Send acknowledgment back to the teacher
      socket.emit("pollCreated", pollDataToEmit);
    } catch (error) {
      console.error("Error creating poll:", error);
      socket.emit("error", { message: "Failed to create poll" });
    }
  });

  socket.on("kickOut", (userToKick) => {
    for (let id in connectedUsers) {
      if (connectedUsers[id] === userToKick) {
        io.to(id).emit("kickedOut", { message: "You have been kicked out." });
        const userSocket = io.sockets.sockets.get(id);
        if (userSocket) {
          userSocket.disconnect(true);
        }
        delete connectedUsers[id];
        break;
      }
    }
    io.emit("participantsUpdate", Object.values(connectedUsers));
  });

  socket.on("joinChat", ({ username }) => {
    connectedUsers[socket.id] = username;
    io.emit("participantsUpdate", Object.values(connectedUsers));

    socket.on("disconnect", () => {
      delete connectedUsers[socket.id];
      io.emit("participantsUpdate", Object.values(connectedUsers));
    });
  });

  socket.on("studentLogin", (name) => {
    socket.emit("loginSuccess", { message: "Login successful", name });
  });

  socket.on("chatMessage", (message) => {
    io.emit("chatMessage", message);
  });

  socket.on("submitAnswer", (answerData) => {
    try {
      console.log("Received submitAnswer event from socket:", socket.id);
      console.log("Answer data:", JSON.stringify(answerData, null, 2));

      votes[answerData.option] = (votes[answerData.option] || 0) + 1;
      voteOnOption(answerData.pollId, answerData.option);

      console.log("Current votes:", JSON.stringify(votes, null, 2));
      io.emit("pollResults", votes);
      console.log("Emitted pollResults event to all clients");
    } catch (error) {
      console.error("Error handling answer submission:", error);
      socket.emit("error", { message: "Failed to submit answer" });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    console.log("Remaining connected clients:", io.engine.clientsCount);
  });
});

app.get("/", (req, res) => {
  res.send("Polling System Backend");
});

app.post("/teacher-login", (req, res) => {
  TeacherLogin(req, res);
});

app.get("/polls/:teacherUsername", (req, res) => {
  getPolls(req, res);
});

server.listen(port, () => {
  console.log(`Server running on port ${port}...`);
});
